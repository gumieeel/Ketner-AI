import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  OpenAiIcon,
  ClaudeIcon,
  GeminiIcon,
  DeepSeekIcon,
  QwenIcon,
  GrokIcon,
} from '@/components/icons/brands';
import { CornerMark } from '@/components/ui/corner-mark';
import { SendIcon } from '@/components/icons';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface ChatModel {
  id: string;
  name: string;
  tag: string;
  icon: typeof OpenAiIcon;
  iconColor: string;
  responseRu: string;
  responseEn: string;
}

const CHAT_MODELS: ChatModel[] = [
  {
    id: 'gpt',
    name: 'GPT-6',
    tag: 'Astra',
    icon: OpenAiIcon,
    iconColor: 'text-emerald-500',
    responseRu:
      'Классические компьютеры обрабатывают данные последовательно с помощью бинарных битов (0 или 1). Квантовые компьютеры используют кубиты и суперпозицию для одновременной обработки множества состояний.',
    responseEn:
      'Classical computers process data sequentially using binary bits (0 or 1). Quantum computers utilize qubits and superposition to evaluate multiple states simultaneously.',
  },
  {
    id: 'claude',
    name: 'Claude',
    tag: 'Opus',
    icon: ClaudeIcon,
    iconColor: 'text-orange-400',
    responseRu:
      'В то время как классический бит всегда детерминирован и равен 0 либо 1, квантовый кубит может находиться в суперпозиции обоих состояний. Это позволяет квантовым системам экспоненциально ускорять решение специфических вычислительных задач.',
    responseEn:
      'While a classical bit is strictly deterministic (0 or 1), a quantum qubit exists in a superposition of both states. This enables quantum architectures to solve specialized computational problems exponentially faster.',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    tag: 'Pro',
    icon: GeminiIcon,
    iconColor: 'text-blue-500',
    responseRu:
      'Классические вычисления основаны на булевой логике и физических транзисторах. Квантовые вычисления опираются на квантовую механику — запутанность и интерференцию, обеспечивая параллельные вычисления огромных объемов данных.',
    responseEn:
      'Classical computing relies on Boolean logic gates and semiconductor transistors. Quantum computing leverages quantum mechanical properties like entanglement and interference for parallel state evaluations.',
  },
  {
    id: 'grok',
    name: 'Grok',
    tag: '3',
    icon: GrokIcon,
    iconColor: 'text-zinc-200',
    responseRu:
      'Классика: перебирает один маршрут за раз. Квант: исследует все маршруты одновременно благодаря суперпозиции кубитов.',
    responseEn:
      'Classical: explores one pathway at a time. Quantum: explores all pathways at once thanks to qubit superposition.',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    tag: 'Max',
    icon: QwenIcon,
    iconColor: 'text-purple-400',
    responseRu:
      'Классические компьютеры используют биты (0 или 1) для решения задач шаг за шагом. Квантовые компьютеры оперируют кубитами в суперпозиции, проводя комплексные вычисления параллельно.',
    responseEn:
      'Classical systems utilize binary bits to compute step-by-step. Quantum computers use superposed qubits to perform complex state calculations simultaneously.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tag: 'R1',
    icon: DeepSeekIcon,
    iconColor: 'text-sky-400',
    responseRu:
      'Ключевое отличие — способ представления информации: дискретные биты против квантовых кубитов. Суперпозиция и квантовая запутанность позволяют выполнять параллельные преобразования пространств состояний.',
    responseEn:
      'The core distinction lies in information encoding: discrete bits versus probabilistic qubits. Superposition and entanglement allow parallel transformations over high-dimensional state spaces.',
  },
];

export function ChatMock({ className }: { className?: string }) {
  const { language } = useTranslation();
  const [selectedId, setSelectedId] = useState('gpt');

  const activeModel =
    CHAT_MODELS.find((m) => m.id === selectedId) ?? CHAT_MODELS[0];
  const ActiveIcon = activeModel.icon;

  return (
    <div
      className={cn(
        'w-full rounded-lg border border-stroke bg-surface overflow-hidden flex flex-col text-left shadow-sm',
        className,
      )}
    >
      {/* 1. App Titlebar with non-colored dots */}
      <div className="flex items-center justify-between border-b border-stroke bg-surface-2 px-3.5 py-2.5 select-none">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="size-2 rounded-full bg-surface-3" />
            <span className="size-2 rounded-full bg-surface-3" />
            <span className="size-2 rounded-full bg-surface-3" />
          </div>
          <div className="ml-2 flex items-center gap-1.5 font-mono text-xs font-medium text-muted">
            <img
              src="/logo-mark.png"
              alt="Ketner"
              className="size-3.5 object-contain"
            />
            <span>Ketner AI</span>
          </div>
        </div>
      </div>

      {/* 2. Window Body: Left Sidebar + Right Chat Canvas */}
      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] h-[320px] md:h-[380px]">
        {/* Model Selection List */}
        <div className="border-b sm:border-b-0 sm:border-r border-stroke bg-surface-2/40 p-2 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-y-auto">
          {CHAT_MODELS.map((model) => {
            const Icon = model.icon;
            const isSelected = model.id === selectedId;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => setSelectedId(model.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap text-left w-full',
                  isSelected
                    ? 'bg-surface text-text border border-stroke shadow-xs'
                    : 'text-muted hover:text-text hover:bg-surface-2',
                )}
              >
                <span className={cn('shrink-0', model.iconColor)}>
                  <Icon className="size-3.5" />
                </span>
                <span className="truncate">{model.name} {model.tag}</span>
              </button>
            );
          })}
        </div>

        {/* Right Chat Canvas */}
        <div className="p-4 flex flex-col justify-between gap-4 bg-surface overflow-hidden">
          <div className="flex flex-col gap-3.5 overflow-y-auto pr-1">
            {/* User message with bg-surface-2 */}
            <div className="flex items-start gap-2.5 self-end max-w-[90%]">
              <div className="rounded-md bg-surface-2 px-3.5 py-2 text-xs text-text border border-stroke leading-relaxed">
                {language === 'ru'
                  ? 'Объясни разницу между квантовыми и классическими вычислениями в 2 предложениях.'
                  : 'Explain the difference between quantum and classical computing in 2 sentences.'}
              </div>
            </div>

            {/* AI response without bubble */}
            <div className="flex items-start gap-2.5 max-w-[95%]">
              <div
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-sm bg-surface-2 mt-0.5',
                  activeModel.iconColor,
                )}
              >
                <ActiveIcon className="size-3.5" />
              </div>
              <div className="flex flex-col gap-1 text-xs text-text leading-relaxed">
                <span className="font-mono text-[11px] font-semibold text-muted">
                  {activeModel.name} {activeModel.tag}
                </span>
                <p className="text-muted text-xs leading-relaxed">
                  {language === 'ru'
                    ? activeModel.responseRu
                    : activeModel.responseEn}
                </p>
              </div>
            </div>
          </div>

          {/* Interactive input bar with CornerMark */}
          <div className="relative rounded-md border border-stroke bg-surface-2 px-3 py-2 text-xs text-muted flex items-center justify-between gap-2">
            <CornerMark size={8} className="absolute top-1 left-1 text-stroke-strong" />
            <span className="text-subtle select-none pl-2">
              {language === 'ru' ? 'Напишите сообщение…' : 'Type a message…'}
            </span>
            <Link
              to="/chat"
              className="inline-flex size-6 items-center justify-center rounded-sm bg-accent text-accent-text hover:bg-accent-hover transition-colors"
              aria-label="Send"
            >
              <SendIcon className="size-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
