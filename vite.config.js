/** @type {import('vite').UserConfig} */
export default {
  build: {
    lib: {
      entry: ["src/main.ts"],
      formats: ["es"],
      fileName: "zen",
    },
  },
};
