/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BaseRecord, DataProvider } from "@refinedev/core";
import { pb } from "../pocketbase";

export const dataProvider: DataProvider = {
  getList: async ({ resource, pagination, sorters, filters }) => {
    const page = (pagination as any)?.current || 1;
    const perPage = pagination?.pageSize || 10;

    let sort = "";
    if (sorters && sorters.length > 0) {
      sort = sorters
        .map((item) => (item.order === "desc" ? `-${item.field}` : item.field))
        .join(",");
    }

    let filter = "";
    if (filters && filters.length > 0) {
      filter = filters
        .map((item) => {
          if ("field" in item && item.operator === "eq") {
            return `${item.field} = "${item.value}"`;
          }
          if ("field" in item && item.operator === "contains") {
            return `${item.field} ~ "${item.value}"`;
          }
          if ("field" in item && item.operator === "gte") {
            return `${item.field} >= "${item.value}"`;
          }
          if ("field" in item && item.operator === "lte") {
            return `${item.field} <= "${item.value}"`;
          }
          return "";
        })
        .filter(Boolean)
        .join(" && ");
    }

    const result = await pb.collection(resource).getList(page, perPage, {
      sort,
      filter,
    });

    return {
      data: result.items.map((item) => ({ ...item, id: item.id } as BaseRecord as any)),
      total: result.totalItems,
    };
  },

  getOne: async ({ resource, id }) => {
    const result = await pb.collection(resource).getOne(id as string);
    return {
      data: { ...result, id: result.id } as BaseRecord as any,
    };
  },

  create: async ({ resource, variables }) => {
    const result = await pb.collection(resource).create(variables as any);
    return {
      data: { ...result, id: result.id } as BaseRecord as any,
    };
  },

  update: async ({ resource, id, variables }) => {
    const result = await pb
      .collection(resource)
      .update(id as string, variables as any);
    return {
      data: { ...result, id: result.id } as BaseRecord as any,
    };
  },

  deleteOne: async ({ resource, id }) => {
    await pb.collection(resource).delete(id as string);
    return {
      data: { id } as BaseRecord as any,
    };
  },

  getApiUrl: () => pb.baseUrl,

  custom: async ({ url, method, payload, query, headers }) => {
    let response;
    switch (method) {
      case "get":
        response = await pb.send(url, { method, query: query as any, headers });
        break;
      case "post":
      case "put":
      case "patch":
      case "delete":
        response = await pb.send(url, {
          method,
          body: payload,
          query: query as any,
          headers,
        });
        break;
      default:
        throw new Error(`Unknown method ${method}`);
    }
    return { data: response };
  },
};
