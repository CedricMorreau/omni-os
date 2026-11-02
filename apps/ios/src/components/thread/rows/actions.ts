import type { OutputChunk } from '@omni/shared/tool-output.ts';
import { createContext, useContext } from 'react';

import type { SendAnswers } from '../QuestionCard';

export interface RowActions {
  openThread(id: string): void;
  loadWhole(eventId: number): void;
  toggleTurn(turn: number): void;
  toggleCall(id: string): void;
  loadOutput(eventId: number, offset: number): Promise<OutputChunk>;
  answer: SendAnswers;
  cwd: string | null;
}

const idle = (): never => {
  throw new Error('No thread screen is mounted.');
};

const NONE: RowActions = {
  openThread: idle,
  loadWhole: idle,
  toggleTurn: idle,
  toggleCall: idle,
  loadOutput: idle,
  answer: idle,
  cwd: null,
};

export const RowActionsContext = createContext<RowActions>(NONE);

export const useRowActions = () => useContext(RowActionsContext);
