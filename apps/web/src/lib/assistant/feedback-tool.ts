import { FEEDBACK_MAX, SEND_FEEDBACK_TOOL } from "@homeup/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { submitFeedback } from "@/lib/feedback";
import type { AssistantTool } from "./tools";

// The assistant's way to pass feedback to the Rooftap team: an idea, a
// problem, or a gap in what it can do. It leaves the household, so it is
// always proposed first, whatever the trust level, and the proposal card
// shows the whole message.

export function feedbackTool(admin: SupabaseClient, userId: string, groupId: string | null): AssistantTool {
  return {
    name: SEND_FEEDBACK_TOOL,
    description:
      "Send feedback to the team that makes Rooftap: an idea, a problem, or something you could not do. Use it only when the person asks to send feedback. " +
      "Write the message in plain words from the person's point of view, with no household data (names, amounts, addresses) unless they ask for it. " +
      "The person sees the whole message and confirms before it is sent.",
    parameters: {
      type: "object",
      properties: { message: { type: "string", minLength: 1, maxLength: FEEDBACK_MAX, description: "The feedback, as it will be sent." } },
      required: ["message"],
    },
    module: "assistant",
    gate: "propose",
    run: async (args) => {
      const message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) return { content: [{ type: "text", text: JSON.stringify({ error: "Feedback is empty" }) }], isError: true };
      try {
        const { id } = await submitFeedback(admin, { userId, groupId, message });
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, id, sent_to: "the Rooftap team" }) }] };
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ error: e instanceof Error ? e.message : "Feedback not sent" }) }], isError: true };
      }
    },
  };
}
