"use client";

import { useEffect } from "react";

/**
 * Fires a single FAQ tracking event from the public help center to the ingest
 * service (which PII-scrubs + stores it). Anonymous visitor id persists in
 * localStorage. Fail-silent.
 */
export function HelpTracker({
  projectKey,
  type,
  query,
  articleId,
}: {
  projectKey: string;
  type: "faq_view" | "faq_search" | "faq_search_noresult";
  query?: string;
  articleId?: string;
}) {
  useEffect(() => {
    const ingest = process.env.NEXT_PUBLIC_INGEST_URL ?? "http://localhost:4000";
    let anonId = "";
    try {
      anonId = localStorage.getItem("tracki_help_anon") ?? "";
      if (!anonId) {
        anonId = `anon_help_${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("tracki_help_anon", anonId);
      }
    } catch {
      anonId = `anon_help_${Math.random().toString(36).slice(2)}`;
    }
    const props: Record<string, unknown> = {};
    if (query) props.query = query;
    if (articleId) props.article_id = articleId;
    fetch(`${ingest}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      mode: "cors",
      credentials: "omit",
      body: JSON.stringify({
        key: projectKey,
        anonId,
        sessionId: anonId,
        sentAt: Date.now(),
        events: [{ type, ts: Date.now(), path: location.pathname, url: location.href, props }],
      }),
    }).catch(() => {});
  }, [projectKey, type, query, articleId]);

  return null;
}
