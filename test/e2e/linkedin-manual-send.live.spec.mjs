import {
  ALLOWED_TEST_PROFILE_URL,
  expect,
  liveTest,
} from "./linkedin-extension-fixture.mjs";

liveTest("sends one manual LinkedIn test message to Brice", async ({ extension }, testInfo) => {
  const { width, height } = testInfo.project.use.viewport;
  testInfo.annotations.push({
    type: "viewport",
    description: `${testInfo.project.name}: ${width}x${height}`,
  });
  const message = `Cold DM Playwright e2e ${new Date().toISOString()}`;

  await extension.clearManualTestState();
  await extension.sidepanel.getByText("Manual test", { exact: true }).click();
  await extension.sidepanel.locator("#manual-test-platform").selectOption("linkedin");
  await extension.sidepanel.locator("#manual-test-target").fill(ALLOWED_TEST_PROFILE_URL);
  await expect(extension.sidepanel.locator("#manual-test-target")).toHaveValue(ALLOWED_TEST_PROFILE_URL);
  await extension.sidepanel.locator("#manual-test-message").fill(message);
  const linkedInConversation = extension.waitForLinkedInConversation();
  await extension.sidepanel.locator("#manual-test-send-button").click();

  await expect.poll(async () => {
    const history = await extension.readManualTestHistory();
    return history[0]?.status;
  }, { timeout: 45_000 }).toBe("sent");

  await extension.sidepanel.getByRole("tab", { name: "History" }).click();
  await expect(extension.sidepanel.locator("#history-list").getByText("✓ Sent", { exact: true })).toBeVisible();
  await expect((await linkedInConversation).getByText(message, { exact: true })).toBeVisible({ timeout: 15_000 });
});
