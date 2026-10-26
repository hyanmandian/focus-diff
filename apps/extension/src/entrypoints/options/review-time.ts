import { i18n } from '#i18n';
import { chevronIcon, closeIcon } from '@/components/icons';
import { h } from '@/utils/dom';
import type { Config } from '@/utils/filters/filters';
import { $ } from '@/utils/page';
import { KINDS, normalizeLearned, paceFactors, PACES, type Kind, type Learned, type Pace } from '@/utils/review-time/review-time';
import {
  EVERY_HOURS,
  EXTRA_MINUTES,
  MINUTE_PRESETS,
  newSession,
  nextOccurrence,
  normalizeReviewTime,
  ORDERS,
  SNOOZE_MINUTES,
  type Opens,
  type Order,
  type ReviewSession,
  type ReviewTimeSettings,
} from '@/utils/review-time/sessions';
import { learnedItem } from '@/utils/storage/storage';
import { dayName, language, sessionSummary, time, WEEK } from '@/utils/review-time/summary';
import { notifySwitch, repoPicker, soundPicker, switchInput, toggleChip } from './widgets';

const ORDER_NAMES: Record<Order, [string, string]> = {
  oldest: [i18n.t('reviewOrderOldest'), i18n.t('reviewOrderOldestHint')],
  quickest: [i18n.t('reviewOrderQuickest'), i18n.t('reviewOrderQuickestHint')],
  fill: [i18n.t('reviewOrderFill'), i18n.t('reviewOrderFillHint')],
};
const PACE_NAMES: Record<Pace, string> = {
  careful: i18n.t('reviewPaceCareful'),
  steady: i18n.t('reviewPaceSteady'),
  quick: i18n.t('reviewPaceQuick'),
};
const KIND_NAMES: Record<Kind, string> = {
  code: i18n.t('kindCode'),
  tests: i18n.t('kindTests'),
  docs: i18n.t('kindDocs'),
  styles: i18n.t('kindStyles'),
  config: i18n.t('kindConfig'),
  generated: i18n.t('kindGenerated'),
};
const OPENS: Opens[] = ['first', 'all', 'none'];
const OPENS_NAMES: Record<Opens, string> = {
  first: i18n.t('reviewOpensFirst'),
  all: i18n.t('reviewOpensAll'),
  none: i18n.t('reviewOpensNone'),
};

/** Radio buttons drawn as one control, a pill per choice. */
const segmented = <T extends string>(name: string, label: string, choices: [T, string][], value: T, onPick: (value: T) => void) => {
  const group = h(
    'div',
    { className: 'segmented', role: 'radiogroup' },
    ...choices.map(([choice, text]) => {
      const id = `${name}-${choice}`;
      const radio = h('input', { type: 'radio', name, id, value: choice, checked: value === choice });
      radio.addEventListener('change', () => onPick(choice));
      return h('span', { className: 'segment' }, radio, h('label', { htmlFor: id, textContent: text }));
    }),
  );
  group.setAttribute('aria-label', label);
  return group;
};

const block = (legend: string, ...children: (Node | null)[]) =>
  h('fieldset', { className: 'session-block' }, h('legend', { textContent: legend }), ...children);

const errorText = (id: string) => h('p', { className: 'error', id, 'aria-live': 'polite' });

/**
 * Settings' Review time section: one switch, the reader's review times as cards, each folded to a line that says when
 * and for how long, and unfolded, when, how long, in what order, and what to review; then how estimates are made and
 * what happens when it's time.
 */
export const createReviewTime = ({
  onChange,
  say,
  config,
  onEnabled,
}: {
  onChange: () => void;
  say: (text: string, tone: 'error') => void;
  config: () => Config;
  onEnabled: (on: boolean) => void;
}) => {
  let settings: ReviewTimeSettings = normalizeReviewTime({});
  /** Checks for every field that can be wrong, to run on save. */
  let checks: (() => boolean)[] = [];
  const open = new Set<string>();
  const toggle = $<HTMLInputElement>('#review-on');
  const body = $('#review-body');
  const permission = $('#review-permission');
  const sessions = $('#sessions');

  const changed = () => {
    syncHint();
    onChange();
  };

  const syncHint = () => {
    const next = nextOccurrence(settings, Date.now());
    const hint = $('#review-on-hint');
    if (!settings.enabled) hint.textContent = i18n.t('reviewOnHint');
    else if (!next) hint.textContent = i18n.t('reviewNoneNext');
    else {
      const at = new Intl.DateTimeFormat(language, { weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(next.at);
      hint.textContent = i18n.t('reviewNext', [at, next.session.name || i18n.t('reviewTimeName'), next.session.minutes]);
    }
    onEnabled(settings.enabled && Boolean(next));
  };

  /** When: days, then set times or every few hours. */
  const whenBlock = (session: ReviewSession, refresh: () => void) => {
    const days = h(
      'div',
      { className: 'chips', role: 'group' },
      ...WEEK.map((day) =>
        toggleChip(
          dayName(day, 'short'),
          session.days.includes(day),
          (on) => {
            session.days = on ? [...session.days, day].toSorted() : session.days.filter((each) => each !== day);
            refresh();
          },
          dayName(day, 'long'),
        ),
      ),
    );
    days.setAttribute('aria-label', i18n.t('reviewDays'));
    const daysError = errorText(`session-${session.id}-days-error`);

    const timesError = errorText(`session-${session.id}-times-error`);
    const timeList = h('ul', { className: 'repo-chips', role: 'list' });
    const newTime = h('input', { type: 'time', id: `session-${session.id}-time`, value: '' });
    newTime.setAttribute('aria-label', i18n.t('reviewAddTimeLabel'));
    newTime.setAttribute('aria-describedby', timesError.id);
    const drawTimes = () =>
      timeList.replaceChildren(
        ...session.times.map((value) => {
          const remove = h('button', { type: 'button', className: 'chip-remove' }, closeIcon());
          remove.setAttribute('aria-label', i18n.t('removeNamed', [time(value)]));
          remove.addEventListener('click', () => {
            session.times = session.times.filter((each) => each !== value);
            drawTimes();
            refresh();
            newTime.focus();
          });
          return h('li', { className: 'repo-chip' }, h('span', { textContent: time(value) }), remove);
        }),
      );
    const addTime = h('button', { type: 'button', className: 'btn quiet', textContent: i18n.t('reviewAddTime') });
    const add = () => {
      if (!newTime.value) return newTime.focus();
      session.times = [...new Set([...session.times, newTime.value])].toSorted();
      newTime.value = '';
      timesError.textContent = '';
      newTime.removeAttribute('aria-invalid');
      drawTimes();
      refresh();
    };
    addTime.addEventListener('click', add);
    newTime.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      add();
    });
    drawTimes();
    const times = h('div', { className: 'session-times' }, h('div', { className: 'time-picker' }, timeList, newTime, addTime), timesError);

    const everyId = `session-${session.id}-every`;
    const every = h(
      'select',
      { id: everyId },
      ...EVERY_HOURS.map((hours) => new Option(i18n.t('reviewHours', hours, [hours]), String(hours))),
    );
    every.value = String(session.every);
    every.addEventListener('change', () => {
      session.every = Number(every.value);
      refresh();
    });
    const span = (key: 'from' | 'to', label: string) => {
      const input = h('input', { type: 'time', id: `session-${session.id}-${key}`, value: session[key] });
      input.addEventListener('change', () => {
        if (input.value) session[key] = input.value;
        refresh();
      });
      return [h('label', { htmlFor: input.id, textContent: label }), input];
    };
    const spanError = errorText(`session-${session.id}-span-error`);
    const hours = h(
      'div',
      { className: 'session-every' },
      h(
        'div',
        { className: 'quiet-fields flat' },
        h('label', { htmlFor: everyId, textContent: i18n.t('reviewEvery') }),
        every,
        ...span('from', i18n.t('notifyQuietFrom')),
        ...span('to', i18n.t('notifyQuietTo')),
      ),
      spanError,
    );

    const syncRepeat = () => {
      times.hidden = session.repeat !== 'times';
      hours.hidden = session.repeat !== 'every';
    };
    syncRepeat();
    const repeat = segmented(
      `session-${session.id}-repeat`,
      i18n.t('reviewRepeat'),
      [
        ['times', i18n.t('reviewRepeatTimes')],
        ['every', i18n.t('reviewRepeatEvery')],
      ],
      session.repeat,
      (value) => {
        session.repeat = value;
        syncRepeat();
        refresh();
      },
    );

    checks.push(() => {
      daysError.textContent = session.days.length ? '' : i18n.t('errorReviewDays');
      // A time typed but not added yet is added on save rather than lost.
      if (newTime.value) add();
      const noTimes = session.repeat === 'times' && session.times.length === 0;
      timesError.textContent = noTimes ? i18n.t('errorReviewTimes') : '';
      if (noTimes) newTime.setAttribute('aria-invalid', 'true');
      else newTime.removeAttribute('aria-invalid');
      const backwards = session.repeat === 'every' && session.from > session.to;
      spanError.textContent = backwards ? i18n.t('errorReviewSpan') : '';
      return session.days.length > 0 && !noTimes && !backwards;
    });

    return block(i18n.t('notifyTiming'), days, daysError, repeat, times, hours);
  };

  /** How long, and in what order the pull requests that fit are picked. */
  const lengthBlock = (session: ReviewSession, refresh: () => void) => {
    const otherId = `session-${session.id}-minutes`;
    const other = h('input', {
      type: 'number',
      id: otherId,
      min: 5,
      max: 240,
      step: 5,
      value: String(session.minutes),
      className: 'minutes-input',
    });
    const presets = h('div', { className: 'chips', role: 'group' });
    presets.setAttribute('aria-label', i18n.t('reviewLength'));
    const drawPresets = () =>
      presets.replaceChildren(
        ...MINUTE_PRESETS.map((minutes) =>
          toggleChip(i18n.t('reviewMinutesShort', [minutes]), session.minutes === minutes, () => {
            session.minutes = minutes;
            other.value = String(minutes);
            drawPresets();
            refresh();
            presets.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
          }),
        ),
      );
    drawPresets();
    other.addEventListener('change', () => {
      const minutes = Math.min(240, Math.max(5, Math.round(Number(other.value) || session.minutes)));
      session.minutes = minutes;
      other.value = String(minutes);
      drawPresets();
      refresh();
    });
    const order = h(
      'div',
      { className: 'choices', role: 'radiogroup' },
      ...ORDERS.map((choice) => {
        const id = `session-${session.id}-order-${choice}`;
        const radio = h('input', {
          type: 'radio',
          name: `session-${session.id}-order`,
          id,
          value: choice,
          checked: session.order === choice,
        });
        radio.setAttribute('aria-describedby', `${id}-hint`);
        radio.addEventListener('change', () => {
          session.order = choice;
          refresh();
        });
        const [name, hint] = ORDER_NAMES[choice];
        return h(
          'div',
          { className: 'choice' },
          radio,
          h(
            'div',
            { className: 'setting-text' },
            h('label', { htmlFor: id, textContent: name }),
            h('p', { className: 'hint', id: `${id}-hint`, textContent: hint }),
          ),
        );
      }),
    );
    order.setAttribute('aria-label', i18n.t('reviewOrder'));
    return block(
      i18n.t('reviewLength'),
      presets,
      h('div', { className: 'inline-field' }, h('label', { htmlFor: otherId, textContent: i18n.t('reviewOtherMinutes') }), other),
      h('span', { className: 'field-label', textContent: i18n.t('reviewOrder') }),
      order,
    );
  };

  /** What to review: the filters whose files count, drafts or not, and the repositories. */
  const whatBlock = (session: ReviewSession, refresh: () => void) => {
    const { global, repos } = config();
    const named = (filter: { name: string }) => filter.name.trim();
    const options = [
      ...global.filter(named).map((filter) => ({ id: filter.id, label: named(filter), repo: '' })),
      ...repos.flatMap((entry) => entry.filters.filter(named).map((filter) => ({ id: filter.id, label: named(filter), repo: entry.repo }))),
    ];
    // Filters since deleted are let go.
    session.filters = session.filters.filter((id) => options.some((option) => option.id === id));
    const chips = h('div', { className: 'chips', role: 'group' });
    chips.setAttribute('aria-label', i18n.t('reviewFiles'));
    /** Drawn again after a pick, since All and the filters press each other off; the focus stays on the chip picked. */
    const draw = (focus = -1) => {
      chips.replaceChildren(
        toggleChip(i18n.t('reviewAllFiles'), session.filters.length === 0, () => {
          session.filters = [];
          draw(0);
          refresh();
        }),
        ...options.map((option, index) =>
          toggleChip(option.repo ? `${option.label} · ${option.repo}` : option.label, session.filters.includes(option.id), (on) => {
            session.filters = on ? [...session.filters, option.id] : session.filters.filter((id) => id !== option.id);
            draw(index + 1);
            refresh();
          }),
        ),
      );
      if (focus >= 0) chips.querySelectorAll<HTMLElement>('button')[focus]?.focus();
    };
    draw();
    const drafts = switchInput(`session-${session.id}-drafts`, session.drafts);
    drafts.addEventListener('change', () => {
      session.drafts = drafts.checked;
      refresh();
    });
    const picker = (key: 'repos' | 'excludeRepos', label: string) => {
      const made = repoPicker({
        id: `session-${session.id}-${key}`,
        label,
        values: session[key],
        onChange: (values) => {
          session[key] = values;
          refresh();
        },
      });
      checks.push(made.check);
      return made.element;
    };
    return block(
      i18n.t('reviewWhat'),
      h('span', { className: 'field-label', textContent: i18n.t('reviewFiles') }),
      chips,
      h('p', { className: 'hint', textContent: options.length ? i18n.t('reviewFilesHint') : i18n.t('reviewNoFilters') }),
      h('div', { className: 'toggle-row' }, drafts, h('label', { htmlFor: drafts.id, textContent: i18n.t('reviewDrafts') })),
      h(
        'div',
        { className: 'repo-rows' },
        h(
          'div',
          { className: 'repo-row' },
          h('span', { className: 'repo-row-label', textContent: i18n.t('notifyReposOnly') }),
          picker('repos', i18n.t('notifyReposOnly')),
        ),
        h(
          'div',
          { className: 'repo-row' },
          h('span', { className: 'repo-row-label', textContent: i18n.t('notifyReposNever') }),
          picker('excludeRepos', i18n.t('notifyReposNever')),
        ),
      ),
    );
  };

  /** A review time as a card: its switch, name and when, folded; unfolded, everything about it. */
  const sessionCard = (session: ReviewSession, focus = false) => {
    const label = () => session.name || i18n.t('reviewTimeName');
    const on = switchInput(`session-${session.id}-on`, session.on);
    const name = h('input', {
      type: 'text',
      className: 'session-name',
      value: session.name,
      placeholder: i18n.t('reviewTimeName'),
      maxLength: 60,
      autocomplete: 'off',
    });
    const summary = h('p', { className: 'session-summary hint', id: `session-${session.id}-summary` });
    const bodyId = `session-${session.id}-body`;
    const expand = h('button', { type: 'button', className: 'icon-btn session-expand' }, chevronIcon('right'));
    const remove = h('button', { type: 'button', className: 'icon-btn session-remove' }, closeIcon());
    const syncLabels = () => {
      on.setAttribute('aria-label', i18n.t('reviewSessionOn', [label()]));
      name.setAttribute('aria-label', i18n.t('reviewSessionName'));
      expand.setAttribute('aria-label', i18n.t('reviewSessionEdit', [label()]));
      remove.setAttribute('aria-label', i18n.t('removeNamed', [label()]));
      remove.title = i18n.t('removeNamed', [label()]);
    };
    const refresh = () => {
      summary.textContent = sessionSummary(session);
      card.classList.toggle('off', !session.on);
      changed();
    };
    const content = h('div', { className: 'session-body', id: bodyId });
    content.append(
      h('div', { className: 'session-columns' }, whenBlock(session, refresh), lengthBlock(session, refresh)),
      whatBlock(session, refresh),
    );
    const setOpen = (value: boolean) => {
      content.hidden = !value;
      expand.setAttribute('aria-expanded', String(value));
      if (value) open.add(session.id);
      else open.delete(session.id);
    };
    expand.setAttribute('aria-controls', bodyId);
    expand.addEventListener('click', () => setOpen(Boolean(content.hidden)));
    on.setAttribute('aria-describedby', summary.id);
    on.addEventListener('change', () => {
      session.on = on.checked;
      refresh();
    });
    name.addEventListener('input', () => {
      session.name = name.value;
      syncLabels();
      changed();
    });
    remove.addEventListener('click', () => {
      settings.sessions = settings.sessions.filter((each) => each !== session);
      open.delete(session.id);
      render();
      $('#add-session').focus();
      changed();
    });
    const card = h(
      'li',
      { className: `session${session.on ? '' : ' off'}` },
      h('div', { className: 'session-head' }, on, h('div', { className: 'session-title' }, name, summary), expand, remove),
      content,
    );
    syncLabels();
    summary.textContent = sessionSummary(session);
    setOpen(open.has(session.id));
    if (focus) requestAnimationFrame(() => name.focus());
    return card;
  };

  const learnedView = (learned: Learned) => {
    const view = $('#learned');
    const { kinds } = paceFactors(learned);
    const known = KINDS.filter((kind) => (learned.kinds[kind]?.files ?? 0) > 0);
    if (!known.length) {
      view.replaceChildren(h('p', { className: 'hint', textContent: i18n.t('reviewLearnedNothing') }));
      return;
    }
    const reset = h('button', { type: 'button', className: 'btn quiet small', textContent: i18n.t('reviewLearnedReset') });
    reset.addEventListener('click', async () => {
      await learnedItem.setValue(null);
      $('#review-learn').focus();
    });
    view.replaceChildren(
      h('p', { className: 'learned-title', textContent: i18n.t('reviewLearnedFrom', learned.all.files, [learned.all.files]) }),
      h(
        'dl',
        { className: 'learned-list' },
        ...known.map((kind) => {
          const factor = kinds[kind];
          const percent = Math.round(Math.abs(factor - 1) * 100);
          const text =
            percent < 5
              ? i18n.t('reviewLearnedSame')
              : factor > 1
                ? i18n.t('reviewLearnedSlower', [percent])
                : i18n.t('reviewLearnedFaster', [percent]);
          return h('div', {}, h('dt', { textContent: KIND_NAMES[kind] }), h('dd', { textContent: text }));
        }),
      ),
      reset,
    );
  };
  void learnedItem.getValue().then((value) => learnedView(normalizeLearned(value)));
  learnedItem.watch((value) => learnedView(normalizeLearned(value)));

  const pace = $('#pace');
  const paceChoices = segmented(
    'review-pace',
    i18n.t('reviewPace'),
    (Object.keys(PACES) as Pace[]).map((key) => [key, PACE_NAMES[key]]),
    settings.pace,
    (value) => {
      settings.pace = value;
      changed();
    },
  );
  paceChoices.removeAttribute('role');
  paceChoices.removeAttribute('aria-label');
  pace.append(paceChoices, h('p', { className: 'hint', id: 'pace-hint' }));

  const select = <T extends string | number>(id: string, values: readonly T[], label: (value: T) => string) => {
    const element = $<HTMLSelectElement>(`#${id}`);
    element.replaceChildren(...values.map((value) => new Option(label(value), String(value))));
    return element;
  };
  const perPull = select('review-per-pull', EXTRA_MINUTES, (minutes) =>
    minutes ? i18n.t('reviewMinutesShort', [minutes]) : i18n.t('reviewNone'),
  );
  const opens = select('review-opens', OPENS, (value) => OPENS_NAMES[value]);
  const snooze = select('review-snooze', SNOOZE_MINUTES, (minutes) => i18n.t('reviewMinutesShort', [minutes]));
  const switches = {
    learn: $<HTMLInputElement>('#review-learn'),
    unviewedOnly: $<HTMLInputElement>('#review-unviewed'),
    againFirst: $<HTMLInputElement>('#review-again-first'),
    queueEstimates: $<HTMLInputElement>('#review-queue-estimates'),
    applyFilters: $<HTMLInputElement>('#review-filters'),
    remindEnd: $<HTMLInputElement>('#review-remind-end'),
    skipEmpty: $<HTMLInputElement>('#review-skip-empty'),
    holdWhileReviewing: $<HTMLInputElement>('#review-hold'),
  };

  const render = () => {
    checks = [];
    toggle.checked = settings.enabled;
    body.hidden = !settings.enabled;
    sessions.replaceChildren(...settings.sessions.map((session) => sessionCard(session)));
    $<HTMLButtonElement>('#add-session').hidden = settings.sessions.length >= 10;
    for (const input of pace.querySelectorAll<HTMLInputElement>('input')) input.checked = input.value === settings.pace;
    $('#pace-hint').textContent = i18n.t('reviewPaceHint', [PACES[settings.pace]]);
    perPull.value = String(settings.perPull);
    opens.value = settings.opens;
    snooze.value = String(settings.snooze);
    for (const [key, input] of Object.entries(switches)) input.checked = settings[key as keyof typeof switches];
    $('#learned').hidden = !settings.learn;
    $('#review-sound').replaceChildren(
      soundPicker({ id: 'review-sound-choice', label: i18n.t('soundLabel'), value: settings.sound, onChange }),
    );
    syncHint();
    void permissionSwitch.sync();
  };

  const permissionSwitch = notifySwitch({
    toggle,
    permission,
    allowButton: $('#review-allow'),
    isOn: () => settings.enabled,
    onToggle: (on) => {
      settings.enabled = on;
      body.hidden = !on;
      // Turned on with none yet, it starts with one, open, to fill in.
      if (on && !settings.sessions.length) {
        const session = newSession();
        settings.sessions.push(session);
        open.add(session.id);
        render();
      }
      changed();
    },
    say,
  });
  $('#add-session').addEventListener('click', () => {
    const session = newSession();
    settings.sessions.push(session);
    open.add(session.id);
    sessions.append(sessionCard(session, true));
    $<HTMLButtonElement>('#add-session').hidden = settings.sessions.length >= 10;
    changed();
  });
  pace.addEventListener('change', () => ($('#pace-hint').textContent = i18n.t('reviewPaceHint', [PACES[settings.pace]])));
  perPull.addEventListener('change', () => {
    settings.perPull = Number(perPull.value);
    changed();
  });
  opens.addEventListener('change', () => {
    settings.opens = opens.value as Opens;
    changed();
  });
  snooze.addEventListener('change', () => {
    settings.snooze = Number(snooze.value);
    changed();
  });
  for (const [key, input] of Object.entries(switches)) {
    input.addEventListener('change', () => {
      settings[key as keyof typeof switches] = input.checked;
      if (key === 'learn') $('#learned').hidden = !input.checked;
      changed();
    });
  }

  return {
    render: (next: ReviewTimeSettings) => {
      settings = structuredClone(next);
      render();
    },
    /** Drawn again for filters added or renamed, keeping what's unsaved. */
    redraw: () => render(),
    value: (): ReviewTimeSettings => normalizeReviewTime(settings),
    /** Whether every time and repository reads right; if not, says so at the field, unfolding its card. */
    check: (): boolean => {
      // Turned off, review times aren't used, and what's wrong in them, out of sight, mustn't hold up the rest.
      if (!settings.enabled) return true;
      const ok = checks.map((check) => check()).every(Boolean);
      if (!ok) {
        for (const card of sessions.querySelectorAll<HTMLElement>('.session')) {
          const body = $('.session-body', card);
          if (body.hidden && card.querySelector('.error:not(:empty), [aria-invalid="true"]')) {
            body.hidden = false;
            card.querySelector('.session-expand')?.setAttribute('aria-expanded', 'true');
          }
        }
      }
      return ok;
    },
    /** Takes the reader to the first thing to fix: its field, or for days, the first day. */
    focusError: () => {
      const field = sessions.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (field) return field.focus();
      const error = sessions.querySelector<HTMLElement>('.error:not(:empty)');
      error?.previousElementSibling?.querySelector<HTMLElement>('button, input')?.focus();
    },
  };
};
