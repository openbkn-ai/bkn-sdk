import type { BknBusinessContext, BknClient, ManagedOperationCall } from "../src/index.js";

export interface BusinessQueryResult {
  answer: string;
}

/**
 * Run one third-party Agent turn under the BKN Trace 3.0 managed lifecycle.
 * The transport callback must pass `context` to the actual OpenBKN business call.
 */
export async function runBusinessInteraction(
  client: BknClient,
  externalConversationKey: string,
  invokeOpenBkn: (
    context: BknBusinessContext,
    operation: ManagedOperationCall["operation"],
  ) => Promise<BusinessQueryResult>,
) {
  return await client.trace.withInteraction(
    { mode: "ensure_current", externalConversationKey },
    async (interaction) => {
      const query = await interaction.runOperation(
        {
          operationKey: "sales-orders-by-product",
          toolName: "query_object_instance",
          input: {
            kn_id: "supplychain_hd0202",
            ot_id: "purchase_order",
            filters: [{ field: "product_code", op: "==", value: "P-001" }],
          },
          required: true,
        },
        async ({ context, operation }) => {
          const result = await invokeOpenBkn(context, operation);
          return result.answer;
        },
      );

      if (query.recovered) {
        throw new Error(
          "Operation completed but its business response must be reloaded by reference",
        );
      }
      return {
        completion_manifest_version: "3.0.0",
        completion_reason: "answer_completed",
        claims: [],
      };
    },
  );
}
