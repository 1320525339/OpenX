/** 本机 OpenX API 基址（Connect 自举、内部回调等） */
export function getServerBaseUrl(): string {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = process.env.PORT ?? "3921";
  return `http://${host}:${port}`;
}
