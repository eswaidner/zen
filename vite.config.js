/** @type {import('vite').UserConfig} */
export default {
  build: {
    lib: {
      entry: ["src/zen.ts"],
      formats: ["es"],
      fileName: "zen",
    },
  },
};
