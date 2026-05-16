// Minimal `vscode` module stub so pure logic can be unit-tested under Node.
export const workspace = {
  getConfiguration: () => ({
    get: (_key: string, dflt?: unknown) => dflt,
  }),
};

export const window = {};
