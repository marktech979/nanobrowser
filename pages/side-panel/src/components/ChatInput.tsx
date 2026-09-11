import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import { t } from '@extension/i18n';

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string) => void;
  onStopTask: () => void;

  /**
   * Toggles the always-listening voice mode.
   *
   * When false:
   *   microphone is OFF
   *
   * When true:
   *   microphone stays ON and SidePanel keeps
   *   restarting speech recognition when Chrome
   *   ends an individual recognition session.
   */
  onMicClick?: () => void;

  /**
   * True while the voice mode is enabled and
   * SpeechRecognition is listening/reconnecting.
   */
  isRecording?: boolean;

  /**
   * Kept for compatibility with the existing NanoBrowser
   * component API.
   *
   * The new always-listening implementation does not use
   * this value to disable the microphone button.
   */
  isProcessingSpeech?: boolean;

  disabled: boolean;
  showStopButton: boolean;

  setContent?: (setter: (text: string) => void) => void;

  isDarkMode?: boolean;

  historicalSessionId?: string | null;

  onReplay?: (sessionId: string) => void;
}

// File attachment interface
interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onMicClick,
  isRecording = false,
  isProcessingSpeech = false,
  disabled,
  showStopButton,
  setContent,
  isDarkMode = false,
  historicalSessionId,
  onReplay,
}: ChatInputProps) {
  const [text, setText] = useState('');

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSendButtonDisabled = useMemo(
    () => disabled || (text.trim() === '' && attachedFiles.length === 0),
    [disabled, text, attachedFiles],
  );

  /*
   * Resize textarea whenever its content changes.
   */
  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';

    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
  }, []);

  /*
   * Handle text changes.
   */
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;

      setText(newText);

      resizeTextarea();
    },
    [resizeTextarea],
  );

  /*
   * Expose a method to set the text from SidePanel.
   *
   * The existing NanoBrowser architecture uses this callback,
   * so we keep it completely compatible.
   */
  useEffect(() => {
    if (!setContent) {
      return;
    }

    setContent(setText);
  }, [setContent]);

  /*
   * Initial textarea sizing.
   */
  useEffect(() => {
    resizeTextarea();
  }, [resizeTextarea]);

  /*
   * Submit a normal typed message.
   */
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const trimmedText = text.trim();

      if (!trimmedText && attachedFiles.length === 0) {
        return;
      }

      let messageContent = trimmedText;

      let displayContent = trimmedText;

      /*
       * Security:
       *
       * File contents are explicitly tagged so the background
       * service can distinguish them from the user's instruction.
       */
      if (attachedFiles.length > 0) {
        const fileContents = attachedFiles
          .map(file => {
            return (
              `\n\n<nano_file_content type="file" name="${file.name}">\n` +
              `${file.content}\n` +
              `</nano_file_content>`
            );
          })
          .join('\n');

        messageContent = trimmedText
          ? `${trimmedText}\n\n<nano_attached_files>${fileContents}</nano_attached_files>`
          : `<nano_attached_files>${fileContents}</nano_attached_files>`;

        /*
         * Only show filenames in the chat display.
         * The actual file contents remain in messageContent.
         */
        const fileList = attachedFiles
          .map(file => `📎 ${file.name}`)
          .join('\n');

        displayContent = trimmedText
          ? `${trimmedText}\n\n${fileList}`
          : fileList;
      }

      /*
       * Normal typed-message path.
       *
       * Voice recognition will also eventually call
       * this same callback through SidePanel's
       * handleSendMessage function.
       */
      onSendMessage(messageContent, displayContent);

      setText('');

      setAttachedFiles([]);

      /*
       * Reset the textarea height after sending.
       */
      window.requestAnimationFrame(() => {
        resizeTextarea();
      });
    },
    [text, attachedFiles, onSendMessage, resizeTextarea],
  );

  /*
   * Enter sends the message.
   *
   * Shift + Enter creates a new line.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.nativeEvent.isComposing
      ) {
        e.preventDefault();

        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  /*
   * Replay a historical session.
   */
  const handleReplay = useCallback(() => {
    if (!historicalSessionId || !onReplay) {
      return;
    }

    onReplay(historicalSessionId);
  }, [historicalSessionId, onReplay]);

  /*
   * Open the file picker.
   */
  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /*
   * Read selected text-based files.
   */
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;

      if (!files || files.length === 0) {
        return;
      }

      const newFiles: AttachedFile[] = [];

      const allowedTypes = [
        '.txt',
        '.md',
        '.markdown',
        '.json',
        '.csv',
        '.log',
        '.xml',
        '.yaml',
        '.yml',
      ];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const fileExt =
          '.' +
          file.name
            .split('.')
            .pop()
            ?.toLowerCase();

        /*
         * Only allow text-oriented files.
         */
        if (!allowedTypes.includes(fileExt)) {
          console.warn(
            `File type ${fileExt} not supported. ` +
              `Only text-based files are allowed.`,
          );

          continue;
        }

        /*
         * Maximum file size: 1 MB.
         */
        if (file.size > 1024 * 1024) {
          console.warn(
            `File ${file.name} is too large. ` +
              `Maximum size is 1MB.`,
          );

          continue;
        }

        try {
          const content = await file.text();

          newFiles.push({
            name: file.name,
            content,
            type: file.type || 'text/plain',
          });
        } catch (error) {
          console.error(
            `Error reading file ${file.name}:`,
            error,
          );
        }
      }

      if (newFiles.length > 0) {
        setAttachedFiles(previousFiles => [
          ...previousFiles,
          ...newFiles,
        ]);
      }

      /*
       * Reset input so selecting the same file again
       * will trigger onChange.
       */
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [],
  );

  /*
   * Remove one attachment.
   */
  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles(previousFiles =>
      previousFiles.filter((_, i) => i !== index),
    );
  }, []);

  /*
   * Voice button is intentionally NOT disabled while
   * NanoBrowser is processing a task.
   *
   * This is important because the user requested:
   *
   *     microphone ON
   *     ↓
   *     task executes
   *     ↓
   *     microphone remains ON
   *
   * The button must therefore remain clickable so the
   * user can manually turn voice mode OFF.
   */
  const microphoneDisabled = false;

  return (
    <form
      onSubmit={handleSubmit}
      className={`overflow-hidden rounded-lg border transition-colors ${
        disabled
          ? 'cursor-not-allowed'
          : 'focus-within:border-sky-400 hover:border-sky-400'
      } ${
        isDarkMode
          ? 'border-slate-700'
          : 'border-gray-200'
      }`}
      aria-label={t('chat_input_form')}>
      <div className="flex flex-col">
        {/* ====================================================== */}
        {/* File attachments                                      */}
        {/* ====================================================== */}

        {attachedFiles.length > 0 && (
          <div
            className={`flex flex-wrap gap-2 border-b p-2 ${
              isDarkMode
                ? 'border-slate-700 bg-slate-800'
                : 'border-gray-200 bg-gray-50'
            }`}>
            {attachedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                  isDarkMode
                    ? 'bg-slate-700 text-gray-300'
                    : 'bg-gray-200 text-gray-700'
                }`}>
                <span className="text-xs">
                  📎
                </span>

                <span className="max-w-[150px] truncate">
                  {file.name}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    handleRemoveFile(index)
                  }
                  className={`ml-1 rounded-sm transition-colors ${
                    isDarkMode
                      ? 'hover:bg-slate-600'
                      : 'hover:bg-gray-300'
                  }`}
                  aria-label={`Remove ${file.name}`}>
                  <span className="text-xs">
                    ✕
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ====================================================== */}
        {/* Text input                                             */}
        {/* ====================================================== */}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-disabled={disabled}
          rows={5}
          className={`w-full resize-none border-none p-2 focus:outline-none ${
            disabled
              ? isDarkMode
                ? 'cursor-not-allowed bg-slate-800 text-gray-400'
                : 'cursor-not-allowed bg-gray-100 text-gray-500'
              : isDarkMode
                ? 'bg-slate-800 text-gray-200'
                : 'bg-white text-gray-900'
          }`}
          placeholder={
            attachedFiles.length > 0
              ? 'Add a message (optional)...'
              : t('chat_input_placeholder')
          }
          aria-label={t('chat_input_editor')}
        />

        {/* ====================================================== */}
        {/* Bottom toolbar                                         */}
        {/* ====================================================== */}

        <div
          className={`flex items-center justify-between px-2 py-1.5 ${
            disabled
              ? isDarkMode
                ? 'bg-slate-800'
                : 'bg-gray-100'
              : isDarkMode
                ? 'bg-slate-800'
                : 'bg-white'
          }`}>
          <div className="flex items-center gap-2 text-gray-500">
            {/* ================================================== */}
            {/* File attachment button                            */}
            {/* ================================================== */}

            <button
              type="button"
              onClick={handleFileSelect}
              disabled={disabled}
              aria-label="Attach files"
              title="Attach text files (txt, md, json, csv, etc.)"
              className={`rounded-md p-1.5 transition-colors ${
                disabled
                  ? 'cursor-not-allowed opacity-50'
                  : isDarkMode
                    ? 'text-gray-400 hover:bg-slate-700 hover:text-gray-200'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}>
              <span className="text-lg">
                📎
              </span>
            </button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yaml,.yml"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
            />

            {/* ================================================== */}
            {/* ALWAYS-LISTENING MICROPHONE                       */}
            {/* ================================================== */}

            {onMicClick && (
              <button
                type="button"
                onClick={onMicClick}
                disabled={microphoneDisabled}
                aria-label={
                  isRecording
                    ? 'إيقاف الاستماع الصوتي'
                    : 'تشغيل الاستماع الصوتي'
                }
                aria-pressed={isRecording}
                title={
                  isRecording
                    ? 'إيقاف الاستماع'
                    : 'تشغيل الاستماع'
                }
                className={`
                  relative
                  flex
                  items-center
                  justify-center
                  rounded-full
                  p-3
                  transition-all
                  duration-200
                  focus:outline-none
                  focus:ring-2
                  focus:ring-sky-400
                  focus:ring-offset-1
                  ${
                    isRecording
                      ? 'bg-red-500 text-white shadow-lg shadow-red-500/40 hover:bg-red-600'
                      : isDarkMode
                        ? 'bg-slate-700 text-gray-300 hover:bg-slate-600 hover:text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                  }
                `}
                style={{
                  minWidth: '48px',
                  minHeight: '48px',
                }}>
                {/* Animated outer ring while listening */}
                {isRecording && (
                  <>
                    <span
                      className="
                        absolute
                        inset-0
                        rounded-full
                        animate-ping
                        bg-red-500
                        opacity-20
                      "
                    />

                    <span
                      className="
                        absolute
                        inset-[-3px]
                        rounded-full
                        border-2
                        border-red-400
                        opacity-70
                      "
                    />
                  </>
                )}

                {/* Microphone icon */}
                <FaMicrophone
                  className={`
                    relative
                    z-10
                    size-6
                    ${
                      isRecording
                        ? 'animate-pulse'
                        : ''
                    }
                  `}
                />
              </button>
            )}

            {/* ================================================== */}
            {/* Listening status                                   */}
            {/* ================================================== */}

            {isRecording && (
              <div
                className="
                  flex
                  items-center
                  gap-1.5
                  text-xs
                  font-medium
                  text-red-500
                  select-none
                "
                aria-live="polite">
                <span
                  className="
                    size-2
                    rounded-full
                    bg-red-500
                    animate-pulse
                  "
                />

                <span>
                  Listening...
                </span>
              </div>
            )}

            {/* ================================================== */}
            {/* Compatibility status                              */}
            {/* ================================================== */}

            {isProcessingSpeech && !isRecording && (
              <div
                className="
                  flex
                  items-center
                  gap-1.5
                  text-xs
                  text-gray-500
                  select-none
                "
                aria-live="polite">
                <span
                  className="
                    size-2
                    rounded-full
                    bg-yellow-400
                    animate-pulse
                  "
                />

                <span>
                  Processing...
                </span>
              </div>
            )}
          </div>

          {/* ==================================================== */}
          {/* Right side buttons                                   */}
          {/* ==================================================== */}

          {showStopButton ? (
            <button
              type="button"
              onClick={onStopTask}
              className="
                rounded-md
                bg-red-500
                px-3
                py-1
                text-white
                transition-colors
                hover:bg-red-600
              ">
              {t('chat_buttons_stop')}
            </button>
          ) : historicalSessionId ? (
            <button
              type="button"
              onClick={handleReplay}
              disabled={!historicalSessionId}
              aria-disabled={!historicalSessionId}
              className={`
                rounded-md
                bg-green-500
                px-3
                py-1
                text-white
                transition-colors
                hover:enabled:bg-green-600
                ${
                  !historicalSessionId
                    ? 'cursor-not-allowed opacity-50'
                    : ''
                }
              `}>
              {t('chat_buttons_replay')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              className={`
                rounded-md
                bg-[#19C2FF]
                px-3
                py-1
                text-white
                transition-colors
                hover:enabled:bg-[#0073DC]
                ${
                  isSendButtonDisabled
                    ? 'cursor-not-allowed opacity-50'
                    : ''
                }
              `}>
              {t('chat_buttons_send')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
