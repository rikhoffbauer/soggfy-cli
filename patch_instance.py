with open("src/core/instance.ts", "r") as f:
    content = f.read()

patch = """
    this.process = spawn([binaryPath, ...cefFlags], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    // START PATCH
    const readStream = async (stream, prefix) => {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);
          console.log(`[Spotify-${prefix}] ${text.trim()}`);
        }
      } catch {}
    };
    if (this.process.stdout) readStream(this.process.stdout, "OUT");
    if (this.process.stderr) readStream(this.process.stderr, "ERR");
    // END PATCH
"""

content = content.replace("""    this.process = spawn([binaryPath, ...cefFlags], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });""", patch)

with open("src/core/instance.ts", "w") as f:
    f.write(content)

