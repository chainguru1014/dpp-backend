const fetch = require("node-fetch");

const postHeaders: HeadersInit = {
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
};

const getHeaders: HeadersInit = {
  Accept: "application/json, text/plain, */*",
};

export type RequestType = "GET" | "PUT" | "POST";

function buildOptions<T>(method: RequestType, headers: HeadersInit, entityBytes: T) {
  const result: RequestInit = { method, headers, body: null };

  if (entityBytes != null) {
    result.body = JSON.stringify(entityBytes);
  }
  return result;
}

/**
 * Make a http get-request.
 *
 * @param url the url to request.
 * @return a promise containing the result of the get request.
 */
export function getRequest<R>(url: string): Promise<R | undefined> {
  const options = buildOptions("GET", getHeaders, null);
  return handleFetch(fetch(url, options));
}

/**
 * Make a http put-request.
 *
 * @param url the url to request.
 * @param object the object to put.
 * @return a promise containing whether the put succeeded or not.
 */
export function putRequest<T>(url: string, object: T): Promise<boolean> {
  const options = buildOptions("PUT", postHeaders, object);
  return fetch(url, options)
      .then((response: any) => response.ok)
      .catch(() => false);
}

/**
 * Make a http post-request.
 *
 * @param url the url to request.
 * @param object the object to post.
 * @return a promise containing the result of the post request.
 */
export function postRequest<T, R>(url: string, object: T): Promise<R | undefined> {
  const options = buildOptions("POST", postHeaders, object);
  return handleFetch(fetch(url, options));
}

function handleFetch<T>(promise: Promise<Response>): Promise<T | undefined> {
  return promise
      .then((response) => {
        if (response.status === 200) {
          return response.json();
        } else {
          return undefined;
        }
      })
      .catch(() => undefined);
}

