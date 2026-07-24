export interface AuditResult {
  confidence: number;            // Confidence percentage: 0 to 100
  matchedTransactionId: string | null;
  explanation: string;
}

export interface AuditReasoner {
  reconcile(settlementRecord: any, ledgerCandidates: any[]): Promise<AuditResult>;
}

/**
 * Local deterministic fuzzy matching reasoner used for local ₹0 testing.
 * Triggers low confidence and discrepancies based on mismatching IDs or values.
 */
export class FuzzyAuditReasoner implements AuditReasoner {
  async reconcile(settlementRecord: any, ledgerCandidates: any[]): Promise<AuditResult> {
    const { reservationId, amount, userId } = settlementRecord;

    // Find candidate transactions matching the reservationId
    const directMatch = ledgerCandidates.find(c => c.reservation_id === reservationId);
    if (directMatch) {
      // Check for amount discrepancy
      if (Math.abs(directMatch.amount - amount) > 0.01) {
        return {
          confidence: 80,
          matchedTransactionId: directMatch.transaction_id,
          explanation: `Warning: Direct reservation ID match found, but amounts differ. Ledger: ${directMatch.amount}, Settlement: ${amount}.`
        };
      }
      return {
        confidence: 98,
        matchedTransactionId: directMatch.transaction_id,
        explanation: "Match found with 100% ID correlation and exact transaction amount alignment."
      };
    }

    // Attempt loose match via userId and amount
    const looseMatches = ledgerCandidates.filter(c => c.user_id === userId && Math.abs(c.amount - amount) < 0.01);
    if (looseMatches.length === 1) {
      return {
        confidence: 70, // Below the 95% threshold -> triggers human review pause
        matchedTransactionId: looseMatches[0].transaction_id,
        explanation: `Ambigous Match: Identified single transaction for user ${userId} with matching amount $${amount}, but reservation IDs do not correlate.`
      };
    }

    if (looseMatches.length > 1) {
      return {
        confidence: 40, // Far below the 95% threshold -> triggers human review pause
        matchedTransactionId: null,
        explanation: `Discrepancy: Multiple transaction candidates found for user ${userId} with matching amount $${amount}. Manual mapping required.`
      };
    }

    return {
      confidence: 10,
      matchedTransactionId: null,
      explanation: "No correlation found in transaction ledger for settlement record."
    };
  }
}

/**
 * Bedrock live LLM audit reasoner.
 * Uses AWS Bedrock Converse API to compare records using Claude models.
 */
export class BedrockAuditReasoner implements AuditReasoner {
  private client: any;

  constructor() {
    // Dynamically require to prevent dependency load errors in offline/local modes
    const { BedrockRuntimeClient } = require("@aws-sdk/client-bedrock-runtime");
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_DEFAULT_REGION || "us-east-1",
    });
  }

  async reconcile(settlementRecord: any, ledgerCandidates: any[]): Promise<AuditResult> {
    const { ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
    
    const prompt = `
      You are a financial audit AI engine. Compare the third-party settlement record against the list of database ledger candidates and identify matches.
      
      Settlement Record:
      ${JSON.stringify(settlementRecord, null, 2)}
      
      Ledger Candidates:
      ${JSON.stringify(ledgerCandidates, null, 2)}
      
      Instructions:
      1. Correlate records by reservation_id, user_id, and amount.
      2. If you find a matching transaction, provide its transaction_id and state your confidence (0 to 100).
      3. If there are amount differences or multiple ambiguous matches, set confidence below 95.
      4. Output EXACTLY a JSON structure matching this format, with no markdown wrappers or additional text:
      {
        "confidence": number,
        "matchedTransactionId": "uuid-here" or null,
        "explanation": "concise explanation here"
      }
    `;

    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
          messages: [
            {
              role: "user",
              content: [{ text: prompt }]
            }
          ]
        })
      );
      
      const responseText = response.output.message.content[0].text;
      const result = JSON.parse(responseText.trim());
      return {
        confidence: Number(result.confidence),
        matchedTransactionId: result.matchedTransactionId || null,
        explanation: result.explanation || "Analyzed by Bedrock LLM Agent."
      };
    } catch (e: any) {
      console.error("[BedrockAudit] Live LLM call failed, falling back to fuzzy reasoner.", e);
      return new FuzzyAuditReasoner().reconcile(settlementRecord, ledgerCandidates);
    }
  }
}

/**
 * Factory resolver for AuditReasoner
 */
export function getAuditReasoner(): AuditReasoner {
  const mode = process.env.AUDIT_MODE || "mock";
  if (mode === "live") {
    console.log("[AuditReasoner] Using Live Bedrock Reconciler");
    return new BedrockAuditReasoner();
  }
  return new FuzzyAuditReasoner();
}
