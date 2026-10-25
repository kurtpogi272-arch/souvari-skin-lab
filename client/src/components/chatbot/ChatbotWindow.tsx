import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, X, MessageSquare } from 'lucide-react';
import { chatApi } from '../../api';
import ChatMessageText from './ChatMessageText';

interface Message {
  id: string;
  role: 'user' | 'bot';
  content: string;
  timestamp: Date;
}

interface ChatbotWindowProps {
  onClose: () => void;
  className?: string;
}

const QUICK_REPLIES = [
  'What services do you offer?',
  'What are your best-selling services?',
  'What do you recommend?',
  'How much is a facial?',
  'What products do you have?',
  'What are your clinic hours?',
  'How can I locate your store?',
];

export default function ChatbotWindow({ onClose, className = '' }: ChatbotWindowProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'bot',
      content: "Hello! I'm your clinic assistant. How can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionToken, setSessionToken] = useState<string>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return;

    const userMsg: Message = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const { data } = await chatApi.send({
        message: text.trim(),
        session_token: sessionToken,
      });

      if (data.data?.session_token) {
        setSessionToken(data.data.session_token);
      }

      const botMsg: Message = {
        id: `bot_${Date.now()}`,
        role: 'bot',
        content: data.data?.response || "I'm sorry, I couldn't process your request. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: 'bot',
        content: "Sorry, something went wrong. Please try again later.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleSend = () => sendMessage(input);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`fixed bottom-20 right-4 sm:right-6 w-[350px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100vh-6rem)] bg-white rounded-md border border-neutral-200 flex flex-col z-50 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-neutral-900 flex items-center justify-center">
            <Bot size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-neutral-900">Clinic Assistant</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-neutral-100 transition text-neutral-400 hover:text-neutral-600" aria-label="Close chat">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-1' : 'order-1'}`}>
              {msg.role === 'bot' && (
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-5 h-5 rounded-full bg-neutral-100 flex items-center justify-center">
                    <Bot size={10} className="text-neutral-600" />
                  </div>
                </div>
              )}
              <div
                className={`px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-neutral-900 text-white rounded-md rounded-br-md'
                    : 'bg-neutral-100 text-neutral-900 rounded-md rounded-bl-md'
                }`}
              >
                <ChatMessageText text={msg.content} />
              </div>
            </div>
          </div>
        ))}

        {/* Quick Replies (show only if just the welcome message) */}
        {messages.length === 1 && !sending && (
          <div className="flex flex-wrap gap-2">
            {QUICK_REPLIES.map((reply) => (
              <button
                key={reply}
                onClick={() => sendMessage(reply)}
                className="px-3 py-2 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-full hover:bg-neutral-50 hover:border-neutral-300 transition"
              >
                {reply}
              </button>
            ))}
          </div>
        )}

        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-5 h-5 rounded-full bg-neutral-100 flex items-center justify-center">
                <Bot size={10} className="text-neutral-600" />
              </div>
            </div>
            <div className="px-3.5 py-3 rounded-md rounded-bl-md bg-neutral-100">
              <Loader2 size={14} className="animate-spin text-neutral-400" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-neutral-100 px-3 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={sending}
            className="flex-1 px-3.5 py-2 text-sm rounded-md border border-neutral-200 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="p-2 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
