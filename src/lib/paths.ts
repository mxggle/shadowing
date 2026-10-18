// Paths arrive from Rust as the system writes them: "/" on a Mac, "\" on Windows (sometimes both).

/** The folder names in a relative path such as "Unit 2/Dialogues" or "Unit 2\Dialogues". */
export const pathParts = (path: string) => path.split(/[\\/]/).filter(Boolean);

/** A file's name without its folders and extension: "/a/b/c.mp3" and "C:\a\b\c.mp3" are both "c". */
export const fileStem = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
