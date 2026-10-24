import Foundation

/// POST /api/grokbot. The server sends the thread's text.
private struct GrokBotRequest: Encodable, Sendable {
  let threadID: String

  enum CodingKeys: String, CodingKey {
    case threadID = "thread_id"
  }
}

private struct OKBody: Decodable {
  let ok: Bool
}

extension OmniClient {
  /// Sends the thread's text to Grok Bot. The server adds the channel id and thread id as context.
  public func sendThreadToGrokBot(threadID: String) async throws(OmniAPIError) {
    let _: OKBody = try await send("POST", "/api/grokbot", body: GrokBotRequest(threadID: threadID))
  }
}
