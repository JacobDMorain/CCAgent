const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("claude 1.0.0");
  process.exit(0);
}

const promptIndex = args.indexOf("-p");
const outputFormatIndex = args.indexOf("--output-format");
const prompt = promptIndex >= 0 ? args[promptIndex + 1] ?? "" : "";
const outputFormat = outputFormatIndex >= 0 ? args[outputFormatIndex + 1] ?? "json" : "json";

if (prompt.includes("sleep-until-cancel")) {
  setInterval(() => undefined, 1000);
} else if (outputFormat === "stream-json") {
  console.log(JSON.stringify({ type: "result", result: "Fake review result for test.md" }));
} else {
  console.log(
    JSON.stringify({
      type: "result",
      subtype: "success",
      result: "Fake review result for test.md",
      session_id: "fake-session",
      duration_ms: 100
    })
  );
}
