import axios, { AxiosError } from "axios";
import {
  ConversationMessage,
  KindroidResponse,
  KindroidAIResult,
} from "./types";

/**
 * Build an augmented conversation with persona preamble, global memory,
 * and dynamic memory. These are injected as a synthetic "system" message
 * at the top of the conversation so the AI always receives stable instructions
 * and long-term context.
 */
function buildAugmentedConversation(
  conversation: ConversationMessage[]
): ConversationMessage[] {
  const preamble = process.env.PERSONA_PREAMBLE || "";
  const globalMemory = process.env.GLOBAL_MEMORY || "";
  const dynamicMemory = process.env.DYNAMIC_MEMORY || "";

  const extraBlocks: string[] = [];

  if (preamble.trim().length > 0) {
    extraBlocks.push(
      `Persona & behavior instructions:\n${preamble.trim()}`
    );
  }

  if (globalMemory.trim().length > 0) {
    extraBlocks.push(
      `Long-term memory & world context:\n${globalMemory.trim()}`
    );
  }

  if (dynamicMemory.trim().length > 0) {
    extraBlocks.push(
      `Dynamic, evolving memory:\n${dynamicMemory.trim()}`
    );
  }

  if (extraBlocks.length === 0) {
    // nothing custom to add, return conversation as-is
    return conversation;
  }

  const systemText = extraBlocks.join("\n\n---\n\n");

  const systemMessage: ConversationMessage = {
    username: "system",
    text: systemText,
  };

  // Prepend the system message so it always appears first
  return [systemMessage, ...conversation];
}

/**
 * Calls the Kindroid AI inference endpoint
 * @param sharedAiCode - shared code for API identification
 * @param conversation - array of conversation messages
 * @param enableFilter - whether to enable NSFW filtering
 * @returns KindroidAIResult indicating success with reply or rate limit
 * @throws Error if the API call fails (except for rate limits)
 */
export async function callKindroidAI(
  sharedAiCode: string,
  conversation: ConversationMessage[],
  enableFilter: boolean = false
): Promise<KindroidAIResult> {
  try {
    if (conversation.length === 0) {
      throw new Error("Conversation array cannot be empty");
    }

    // Inject persona + memories at the top of the conversation
    const augmentedConversation = buildAugmentedConversation(conversation);

    const lastUsername =
      augmentedConversation[augmentedConversation.length - 1].username;

    // Encode username to handle non-ASCII characters, then hash to alphanumeric
    const hashedUsername = Buffer.from(encodeURIComponent(lastUsername))
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 32); // Limit length to 32 chars

    const response = await axios.post(
      process.env.KINDROID_INFER_URL!,
      {
        share_code: sharedAiCode,
        conversation: augmentedConversation,
        enable_filter: enableFilter,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.KINDROID_API_KEY!}`,
          "X-Kindroid-Requester": hashedUsername,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.error || "API request failed");
    }

    return {
      type: "success",
      reply: response.data.reply.replace(/@(everyone|here)/g, ""),
    };
  } catch (error) {
    console.error("Error calling Kindroid AI:", (error as Error).message);

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        console.error("Response data:", axiosError.response.data);
        console.error("Response status:", axiosError.response.status);

        if (axiosError.response.status === 429) {
          return { type: "rate_limited" };
        }

        if ((axiosError.response.data as any)?.error) {
          throw new Error((axiosError.response.data as any).error);
        }
      }
    }

    throw new Error("Failed to get response from Kindroid AI");
  }
}
