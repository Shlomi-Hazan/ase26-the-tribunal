import type { Handler, HandlerResponse } from "@netlify/functions";

const responseBody = {
  status: "ok",
  service: "the-tribunal"
} as const;

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    const methodNotAllowedResponse: HandlerResponse = {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "method_not_allowed" })
    };

    return methodNotAllowedResponse;
  }

  const okResponse: HandlerResponse = {
    statusCode: 200,
    headers: {
      "cache-control": "no-store",
      ...jsonHeaders
    },
    body: JSON.stringify(responseBody)
  };

  return okResponse;
};
