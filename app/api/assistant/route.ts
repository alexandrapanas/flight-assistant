import OpenAI from "openai";
import { experimental_AssistantResponse } from "ai";
import { MessageContentText } from "openai/resources/beta/threads/messages/messages";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const runtime = "edge";

const getFlightInfo = async (
  flightNumber: string
): Promise<
  { departure?: string; arrival?: string; status?: string } | undefined
> => {
  try {
    const response = await fetch(
      `http://api.aviationstack.com/v1/flights?access_key=${process.env.AVIATIONSTACK_API_KEY}&flight_iata=${flightNumber}`
    );
    const data = await response.json();

    const departure = data.data[0].departure.scheduled;
    const arrival = data.data[0].arrival.scheduled;
    const status = data.data[0].flight_status;

    return { departure, arrival, status };
  } catch (error) {
    console.log({ error });
  }
};

export async function POST(req: Request) {
  const input: {
    threadId: string;
    message: string;
  } = await req.json();

  // create thread if needed
  const threadId = input.threadId ?? (await openai.beta.threads.create({})).id;

  // add message to thread
  const messageId = (
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: input.message,
    })
  ).id;

  return experimental_AssistantResponse(
    {
      threadId,
      messageId,
    },
    async ({ sendMessage, sendDataMessage, threadId }) => {
      // run the assistant on the thread
      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id:
          process.env.OPENAI_ASSISTANT_ID ??
          (() => {
            throw new Error("OPENAI_ASSISTANT_ID is not set");
          })(),
      });
      async function waitForRun(run: OpenAI.Beta.Threads.Runs.Run) {
        // Poll for status change
        while (run.status === "in_progress" || run.status === "queued") {
          // delay
          await new Promise((resolve) => setTimeout(resolve, 500));
          run = await openai.beta.threads.runs.retrieve(threadId, run.id);
        }
        // throw error if run failed
        if (
          run.status === "cancelled" ||
          run.status === "failed" ||
          run.status === "expired" ||
          run.status === "cancelling"
        ) {
          throw new Error(`Run failed: ${run.status}`);
        }

        if (run.status === "requires_action") {
          if (run.required_action?.type === "submit_tool_outputs") {
            const tool_outputs = await Promise.all(
              run.required_action.submit_tool_outputs.tool_calls.map(
                // return id and output for each tool call
                async (toolCall) => {
                  const params = JSON.parse(toolCall.function.arguments);
                  switch (toolCall.function.name) {
                    case "get_departure_time": {
                      const { departure } =
                        (await getFlightInfo(params.flightNumber)) ?? {};
                      if (departure) {
                        sendDataMessage({
                          role: "data",
                          data: {
                            name: "departure_time",
                            departure,
                            description: `Departure: ${departure}`,
                          },
                        });
                      }

                      return {
                        tool_call_id: toolCall.id,
                        output: `Departure: ${departure}`,
                      };
                    }
                    case "get_arrival_time": {
                      const { arrival } =
                        (await getFlightInfo(params.flightNumber)) ?? {};
                      if (arrival) {
                        sendDataMessage({
                          role: "data",
                          data: {
                            name: "arrival_time",
                            arrival,
                            description: `Arrival: ${arrival}`,
                          },
                        });
                      }
                      return {
                        tool_call_id: toolCall.id,
                        output: `Arrival: ${arrival}`,
                      };
                    }

                    case "get_flight_status": {
                      const { status } =
                        (await getFlightInfo(params.flightNumber)) ?? {};
                      if (status) {
                        sendDataMessage({
                          role: "data",
                          data: {
                            name: "flight_status",
                            status,
                            description: `Flight status: ${status}`,
                          },
                        });
                      }
                      return {
                        tool_call_id: toolCall.id,
                        output: status,
                      };
                    }

                    default:
                      throw new Error(
                        `Unknown tool call: ${toolCall.function.name}`
                      );
                  }
                }
              )
            );
            // console.log({ tool_outputs: JSON.stringify(tool_outputs) });
            run = await openai.beta.threads.runs.submitToolOutputs(
              threadId!,
              run.id,
              {
                tool_outputs,
              }
            );

            await waitForRun(run);
          }
        }
      }
      await waitForRun(run);

      // get new messages (after our message)
      const responseMessages = (
        await openai.beta.threads.messages.list(threadId, {
          after: messageId,
          order: "asc",
        })
      ).data;

      // send messages
      for (const message of responseMessages) {
        sendMessage({
          id: message.id,
          role: "assistant",
          content: message.content.filter(
            (content) => content.type === "text"
          ) as Array<MessageContentText>,
        });
      }
    }
  );
}
