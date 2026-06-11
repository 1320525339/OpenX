#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildApiCatalogResponse,
  listApiCatalog,
  OPENX_MCP_DEFAULT_BASE,
} from "@openx/shared";
import { callOpenxApi, substitutePathParams } from "./client.js";

function getBaseUrl(): string {
  return process.env.OPENX_API_BASE?.trim() || OPENX_MCP_DEFAULT_BASE;
}

const server = new McpServer({
  name: "openx-api",
  version: "0.1.0",
});

server.resource(
  "api-catalog",
  "openx://api-catalog",
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(buildApiCatalogResponse(), null, 2),
      },
    ],
  }),
);

server.tool(
  "openx_list_apis",
  "列出 OpenX 全部 REST API 端点（可按 category 过滤）。自举开发 OpenX 时先调用此工具了解接口。",
  {
    category: z
      .string()
      .optional()
      .describe("可选分类：goals、coach、connect、internal、settings 等"),
  },
  async ({ category }) => {
    const endpoints = listApiCatalog(category ? { category } : undefined);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              baseUrl: getBaseUrl(),
              count: endpoints.length,
              endpoints,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "openx_call_api",
  "调用任意 OpenX REST API。path 支持 :id 占位；/internal/* 自动附带 internal token。",
  {
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP 方法"),
    path: z
      .string()
      .describe("API 路径，如 /api/goals 或 /api/goals/:id/start"),
    pathParams: z
      .record(z.string())
      .optional()
      .describe("路径参数，如 { id: \"abc123\" }"),
    query: z.record(z.string()).optional().describe("查询参数"),
    body: z.unknown().optional().describe("JSON 请求体（POST/PUT/PATCH）"),
  },
  async ({ method, path, pathParams, query, body }) => {
    const resolvedPath = substitutePathParams(path, pathParams);
    const result = await callOpenxApi({
      baseUrl: getBaseUrl(),
      method,
      path: resolvedPath,
      query,
      body,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: !result.ok,
    };
  },
);

server.tool(
  "openx_get_catalog",
  "获取完整 API 目录元数据（版本、分类、鉴权说明）",
  {},
  async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(buildApiCatalogResponse(), null, 2),
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[openx-mcp] fatal:", err);
  process.exit(1);
});
