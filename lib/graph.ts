import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { CLAUDE_MODEL } from "./anthropic";

const getWeather = tool(
  async ({ city }: { city: string }) => {
    const conditions = ["sunny", "cloudy", "rainy", "windy"];
    const condition = conditions[city.length % conditions.length];
    const tempC = 10 + (city.length * 3) % 20;
    return `${city}: ${condition}, ${tempC}°C`;
  },
  {
    name: "get_weather",
    description: "Look up the current weather for a city.",
    schema: z.object({
      city: z.string().describe("City name, e.g. 'Tokyo'"),
    }),
  },
);

const tools = [getWeather];

const model = new ChatAnthropic({
  model: CLAUDE_MODEL,
  streaming: true,
}).bindTools(tools);

async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", new ToolNode(tools))
  .addEdge(START, "agent")
  .addConditionalEdges("agent", toolsCondition, ["tools", END])
  .addEdge("tools", "agent");

export const chatGraph = graph.compile();
