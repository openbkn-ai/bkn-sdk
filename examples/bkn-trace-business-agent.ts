import type {
  BknBusinessContext,
  BknClient,
  ManagedOperationCall,
  OperationReceipt,
} from "../src/index.js";

export interface BusinessQueryResult {
  answer: string;
  receipt: OperationReceipt;
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
          normalizedInputHash: "sha256:replace-with-canonical-input-hash",
          required: true,
        },
        async ({ context, operation }) => {
          const result = await invokeOpenBkn(context, operation);
          return { value: result.answer, receipt: result.receipt };
        },
      );

      if (query.recovered) {
        throw new Error(
          "Operation completed but its business response must be reloaded by reference",
        );
      }
      const evidence = query.receipt.observed_evidence_refs[0];
      if (!evidence) throw new Error("The business result did not return an evidence reference");

      return {
        completion_manifest_version: "3.0.0",
        completion_reason: "answer_completed",
        claims: [
          {
            claim_id: "sales-order-summary",
            claim_type: "answer",
            materiality: "material" as const,
            claim_status: "asserted" as const,
            content_artifact_ref: "artifact:answer-managed-by-ee-extension",
            required_support_roles: ["calculation_input"],
            supports: [
              {
                target_ref: evidence.evidence_ref,
                target_type: "evidence" as const,
                source_interaction_id: evidence.source_interaction_id,
                source_revision_id: evidence.source_revision_id,
                source_operation_id: evidence.source_operation_id,
                version: evidence.version,
                content_hash: evidence.content_hash,
                fragment_selector: evidence.fragment_selector,
                role: "calculation_input",
                status: "adopted" as const,
              },
            ],
          },
        ],
      };
    },
  );
}
