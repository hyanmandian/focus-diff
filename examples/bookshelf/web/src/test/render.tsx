import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createQueryWrapper } from './query-wrapper';

export const renderWithProviders = (ui: ReactElement) => render(ui, { wrapper: createQueryWrapper() });
