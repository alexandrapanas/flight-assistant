"use client";
import { experimental_useAssistant as useAsistant, Message } from "ai/react";

export default function SloganGenerator() {
  const { messages, input, status, handleInputChange, submitMessage } =
    useAsistant({ api: "/api/assistant" });

  return (
    <div>
      <form onSubmit={submitMessage}>
        <label>
          Hello! I am a flight assistant. You can ask me about flights
          (take-offs, landings, status). I can only provide information about
          today&apos;s flights because that&apos;s what&apos;s included in the
          free plan of the API where I get the data from.
          <input
            value={input}
            onChange={handleInputChange}
            disabled={status !== "awaiting_message"}
          />
        </label>
        <button type="submit">Submit question</button>
      </form>

      {messages && messages.length > 0 && (
        <div className="messages">
          {messages.map((m: Message) => (
            <div key={m.id}>{m.role !== "data" && m.content}</div>
          ))}
        </div>
      )}
    </div>
  );
}
