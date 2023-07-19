import axios, { AxiosError } from 'axios';
import { compile } from 'path-to-regexp';

export type Payload = {
  Body?: unknown;
  Querystring?: unknown;
  Params?: Record<string, string>;
  Headers?: unknown;
  Reply: unknown;
};

export type Options<Config extends Payload, Error> = {
  baseURL: string;
  effect?: Effect<Config, Error>;
};

export type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

export type LastOf<T> = UnionToIntersection<
  T extends any ? () => T : never
> extends () => infer R
  ? R
  : never;

export type TuplifyUnion<
  T,
  L = LastOf<T>,
  N = [T] extends [never] ? true : false
> = true extends N ? [] : [...TuplifyUnion<Exclude<T, L>>, L];

export type Effect<Config extends Payload, Error> = (
  action: Fetcher<Config, Error>,
  params: {
    baseURL: string;
    endpoint: string;
    method: string;
  }
) => Fetcher<Config, Error>;

export type EffectAbort = {
  abort: AbortController['abort'];
};

export type Schema<API> = {
  [Endpoint in keyof API]: TuplifyUnion<keyof API[Endpoint]>;
};

export type Methods<MethodsRecord extends object, Error> = {
  [Method in keyof MethodsRecord]: Fetcher<MethodsRecord[Method], Error> &
    EffectAbort;
};

export type Endpoints<EndpointsRecord extends object, Error> = {
  [Endpoint in keyof EndpointsRecord]: Methods<
    EndpointsRecord[Endpoint],
    Error
  >;
};

export type Fetcher<Config extends Payload, Error> = (
  data: Omit<Config, 'Reply' | 'Headers'>
) => Promise<Exclude<Config['Reply'], Error>>;

export const fetcher = <Config extends Payload, Error>(
  baseURL: string,
  url: string,
  method: string
): Fetcher<Config, Error> & EffectAbort => {
  let abortController: AbortController | undefined;

  return Object.assign(
    async ({
      Body,
      Querystring,
      Params,
    }: Partial<{
      Body: Config['Body'];
      Querystring: Config['Querystring'];
      Params: Config['Params'];
    }>) => {
      abortController = new AbortController();

      try {
        const { data } = await axios({
          url: compile(url)(Params),
          method,
          baseURL,
          data: Body,
          params: Querystring,
          withCredentials: true,
          signal: abortController.signal,
        });

        return data;
      } catch (error) {
        const { response, message, code } = error as AxiosError<Error>;

        if (code === 'ERR_CANCELED') {
          return;
        }

        throw (response?.data as any)?.error ?? message ?? 'Unknown error';
      }
    },
    {
      abort: () => {
        if (!abortController) {
          return;
        }

        abortController.abort();
      },
    }
  );
};

export const makeApi = <API extends object, Error, Effect = void>(
  schema: Schema<API>,
  options: Options<Payload, Error>
): Effect extends void ? Endpoints<API, Error> : Effect => {
  const result = schema as any;
  const { baseURL, effect } = options;

  for (const endpoint in result) {
    result[endpoint] = result[endpoint].reduce(
      (acc: Record<string, Fetcher<Payload, Error>>, method: string) => {
        const handler = fetcher(baseURL, endpoint, method);
        const abort = handler.abort;

        acc[method] = effect
          ? Object.assign(effect(handler, { endpoint, method, baseURL }), {
              abort,
            })
          : handler;

        return acc;
      },
      {}
    );
  }

  return result;
};
