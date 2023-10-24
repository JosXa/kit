import { fileURLToPath } from "node:url"

export async function JSXLoad(url) {
  const { build } = await import("esbuild")

  const result = await build({
    entryPoints: [fileURLToPath(url)],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    charset: "utf8",
    write: false,
    tsconfigRaw: {
      compilerOptions: {
        target: "esnext",
        module: "esnext",
        outDir: "./dist",
        rootDir: "./src",
        moduleResolution: "Node",
        lib: ["esnext"],
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
        sourceMap: true,
        // TODO: Load jsx files?
        jsx: "react-jsx",
      },
    },
  })

  return {
    source: result.outputFiles[0].text,
    format: "module",
    shortCircuit: true,
  }
}

export async function NoLoad(url) {
  return {
    source: `export default {}`,
    format: "module",
    shortCircuit: true,
  }
}

export async function load(url, context, defaultLoad) {
  if (
    url.endsWith(".kit") &&
    context?.format === "commonjs"
  ) {
    const transform = await JSXLoad(url)
    return transform
  }

  if (url.endsWith(".kit") && url.includes(".ts?")) {
    // let dir = basename(dirname(url))
    const transform = await JSXLoad(url)
    return transform
  }

  return await defaultLoad(url, context, defaultLoad)
}
