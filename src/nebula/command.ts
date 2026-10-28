// The shell command in a reply's code block, when it holds one, as a single
// line an agent can run: Run sends it to the agent as "! <command>", Claude
// Code's way to run a command itself, so its output lands in the thread.
// Pure, so its tests run under Node.

const SHELL = new Set(["bash", "sh", "shell", "zsh", "console"]);

/** The block's command on one line, or null when it isn't one. `lang` is
 *  the fence's language ("" when it has none). An untagged block counts
 *  when its first line starts with something command-shaped. */
export function commandIn(lang: string, text: string): string | null {
  if (lang && !SHELL.has(lang.toLowerCase())) return null;
  const lines: string[] = [];
  let carry = "";
  for (const raw of text.replace(/\s*\\\n\s*/g, " ").split("\n")) {
    const line = raw.trim().replace(/^\$\s+/, "");
    if (!line || line.startsWith("#")) continue;
    // A line ending in && or | goes on with the next.
    if (/(&&|\|\||\|)$/.test(line)) {
      carry += `${line} `;
      continue;
    }
    lines.push(carry + line);
    carry = "";
  }
  if (carry) lines.push(carry.trim());
  if (!lines.length) return null;
  if (!lang && !/^(sudo\s+)?([a-z][\w.-]*|\.{0,2}\/\S+|~\/\S+)(\s|$)/.test(lines[0])) return null;
  return lines.join(" && ");
}
