export function installLinkedInTestDebugBridge(target, sendLinkedInTestMessage) {
  target.__coldDmLinkedInTest = {
    send: (payload) => sendLinkedInTestMessage(payload),
  };
}
