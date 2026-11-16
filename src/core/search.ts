import { z } from "zod";
import type { Job, Project } from "./schema";
import type { Topic } from "./organization";
export class ImageIndex {
  private words = new Map<string, Set<string>>();
  private all = new Set<string>();
  constructor(jobs: Job[], projects: Project[] = [], topics: Topic[] = []) {
    const projectNames = new Map(
      projects.map((project) => [project.id, project.name]),
    );
    const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
    for (const job of jobs) {
      this.all.add(job.id);
      const text = [
        job.id,
        job.prompt,
        job.originalName,
        job.model,
        job.provider,
        job.source,
        job.createdAt,
        `${job.width}x${job.height}`,
        projectNames.get(job.projectId),
        topicNames.get(job.topicId ?? ""),
        ...(job.tags ?? []).map((tag) => tag.tag),
      ].join(" ");
      for (const word of new Set(this.tokens(text))) {
        const ids = this.words.get(word) ?? new Set<string>();
        ids.add(job.id);
        this.words.set(word, ids);
      }
    }
  }
  static restore(snapshot: unknown) {
    const parsed = z
      .object({
        version: z.literal(1),
        words: z.array(z.tuple([z.string(), z.array(z.string())])),
      })
      .parse(snapshot);
    const index = new ImageIndex([]);
    for (const [word, ids] of parsed.words) {
      index.words.set(word, new Set(ids));
      for (const id of ids) index.all.add(id);
    }
    return index;
  }
  private tokens(text: string) {
    return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  }
  search(query: string) {
    const tokens = this.tokens(query);
    if (!tokens.length) return new Set(this.all);
    let result = new Set(this.all);
    for (const token of tokens) {
      const matches = new Set<string>();
      for (const [word, ids] of this.words)
        if (word.includes(token)) for (const id of ids) matches.add(id);
      result = new Set([...result].filter((id) => matches.has(id)));
    }
    return result;
  }
  snapshot() {
    return [...this.words].map(([word, ids]) => [word, [...ids]] as const);
  }
}

export async function rebuildIndex(store: import("../storage/types").Storage) {
  const [jobs, projects, topics] = await Promise.all([
    store.list<Job>("jobs"),
    store.list<Project>("projects"),
    store.list<Topic>("topics"),
  ]);
  const index = new ImageIndex(jobs, projects, topics);
  await store.put("indexes", "images", {
    version: 1,
    createdAt: new Date().toISOString(),
    words: index.snapshot(),
  });
  return index;
}

export async function loadIndex(store: import("../storage/types").Storage) {
  const snapshot = await store.get("indexes", "images");
  if (snapshot) {
    const restored = (() => {
      try {
        return ImageIndex.restore(snapshot);
      } catch {
        return undefined;
      }
    })();
    if (restored) return restored;
  }
  return rebuildIndex(store);
}

export async function currentIndex(
  store: import("../storage/types").Storage,
  jobs: Job[],
  projects: Project[],
  topics: Topic[],
) {
  const { hash } = await import("./schema");
  const revision = await hash(
    JSON.stringify([
      jobs.map(
        ({
          id,
          prompt,
          originalName,
          model,
          provider,
          source,
          createdAt,
          width,
          height,
          projectId,
          topicId,
          tags,
        }) => [
          id,
          prompt,
          originalName,
          model,
          provider,
          source,
          createdAt,
          width,
          height,
          projectId,
          topicId,
          tags,
        ],
      ),
      projects.map(({ id, name }) => [id, name]),
      topics.map(({ id, name }) => [id, name]),
    ]),
  );
  const saved = await store.get<{ revision?: string; version: number; words: ReturnType<ImageIndex["snapshot"]> }>("indexes", "images");
  if (saved?.revision === revision) {
    try {
      ImageIndex.restore(saved);
      return saved;
    } catch {
      /* Rebuild disposable cache. */
    }
  }
  const snapshot = {
    version: 1,
    revision,
    words: new ImageIndex(jobs, projects, topics).snapshot(),
  };
  await store.put("indexes", "images", snapshot);
  return snapshot;
}
