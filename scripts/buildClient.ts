import * as esbuild from "esbuild";
import { sassPlugin } from "esbuild-sass-plugin";
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { ClientIndex } from "../source/index.tsx";

await buildAdminClient({
  outputDirectoryPath: './dist'
});

async function buildAdminClient({
  outputDirectoryPath
}: {
  outputDirectoryPath: string
}) {
  try {
    await Deno.remove(outputDirectoryPath, { recursive: true });
  } catch (removeError) {
    throw removeError
  }
  await esbuild.build({
    entryPoints: ["source/main.tsx"],
    bundle: true,
    outdir: outputDirectoryPath,
    minify: true,
    sourcemap: true,
    format: "esm",
    target: ["es2020"],
    plugins: [
      sassPlugin({
        filter: /\.module\.scss$/,
        type: "local-css",
      }),
      sassPlugin({
        filter: /\.scss$/,
        type: "css",
      }),
    ],
    jsxFactory: "h",
    jsxFragment: "Fragment",
    inject: ["./source/preact-shim.ts"],
  });
  const indexHtml = renderToString(
    h(ClientIndex, {
      bundleUrl: "/main.js",
      cssUrl: "/main.css",
    })
  );
  await Deno.writeTextFile(`${outputDirectoryPath}/index.html`, `<!DOCTYPE html>${indexHtml}`);
  console.log("⚡ Build complete");
  esbuild.stop();
  Deno.exit(0);
}