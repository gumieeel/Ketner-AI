import { describe, expect, it } from 'vitest';
import { solutionInterface } from './registry';

describe('интерфейс решения по шаблону', () => {
  it('помощник и бот для клиентов — интерфейс помощника', () => {
    expect(solutionInterface({ kind: 'assistant', template: 'personal_assistant' })).toBe(
      'assistant',
    );
    expect(solutionInterface({ kind: 'assistant', template: 'customer_bot' })).toBe('assistant');
  });

  it('неизвестный шаблон или несовпадение вида — без интерфейса, а не чат', () => {
    expect(solutionInterface({ kind: 'tool', template: 'study_assistant' })).toBeNull();
    expect(solutionInterface({ kind: 'tool', template: 'personal_assistant' })).toBeNull();
    expect(solutionInterface({ kind: 'assistant', template: '' })).toBeNull();
  });
});
