export type Command = 'next-filter' | 'previous-filter' | 'show-all';

export type Message = { type: 'open-options'; repo?: string | null } | { type: 'open-welcome' } | { type: 'command'; command: Command };
