const publicMessages = [
  "Project was not found.",
  "Project source was not found.",
  "Script version was not found.",
  "Script content is required.",
  "Script content must be at most 100,000 characters.",
  "Narration job was not found.",
  "The uploaded narration was not found.",
  "The uploaded narration type does not match its declaration.",
  "This narration upload is already queued.",
  "This narration audio type is not supported.",
  "The narration audio file is empty or invalid.",
  "The narration audio file is larger than the 100 MB limit.",
  "Archived projects are read-only.",
  "Channel membership is required.",
  "Enter a valid http or https URL.",
  "Only http and https source URLs are allowed.",
  "Source URLs cannot contain credentials.",
  "Remove credentials and secret parameters from the URL.",
  "This file type is not allowed for project sources.",
  "The source file must contain data.",
  "The source file is larger than the 25 MB limit.",
  "The uploaded file type does not match its declaration.",
  "The uploaded file was not found.",
  "This uploaded file is already a source.",
  "Project storage is not configured.",
  "Project access is not configured.",
] as const;

export function publicProjectError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : "";
  return publicMessages.find((message) => raw.includes(message)) ?? fallback;
}
