import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, hostSignals } from "./contracts/host.js";
import { rpcContract } from "./contracts/rpc.js";
import { FilesService } from "./backend/service.js";
import { registerFilesCli } from "./cli.js";
export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({
    contract: hostContract,
    experimental_signals: hostSignals,
  });
  const files = new FilesService(bb.sdk, host, bb.pluginId);
  bb.onDispose(
    host.experimental_onSignal("changed", ({ payload }) =>
      bb.realtime.publish("files-changed", payload),
    ),
  );
  bb.onDispose(() => files.dispose());
  bb.rpc.register(rpcContract, {
    roots: ({ threadId }) => files.roots(threadId),
    directory: (input) => files.directory(input),
    search: (input) => files.search(input),
    gitStatus: (input) => files.gitStatus(input),
    transfer: (input) => files.transfer(input),
    cancel: (input) => files.cancel(input),
    watch: ({ threadId }) => files.watch(threadId),
  });
  bb.http.route("GET", "/download", (context) => {
    const transfer = files.download(context.req.query("id") ?? "");
    if (!transfer)
      return new Response("File transfer expired", { status: 410 });
    return new Response(new Uint8Array(transfer.bytes), {
      headers: {
        "Content-Type": transfer.metadata.mimeType,
        "Content-Length": String(transfer.bytes.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(transfer.metadata.filename)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
  registerFilesCli(bb, files);
}
