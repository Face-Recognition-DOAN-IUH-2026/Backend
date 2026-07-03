import crypto from 'crypto';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || '';
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'LIB';
const JIRA_ENABLED = process.env.JIRA_ENABLED !== 'false';

// Rate limiter: max 5 bugs per minute
const rateLimiter = {
  timestamps: [] as number[],
  maxPerMinute: 5,
  canSend(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < 60000);
    return this.timestamps.length < this.maxPerMinute;
  },
  record(): void {
    this.timestamps.push(Date.now());
  },
};

// Deduplication: hash of title to avoid duplicate bugs
const deduplicationCache = new Map<string, string>(); // hash -> issueKey
const DEDUP_TTL = 30 * 60 * 1000; // 30 minutes

function deduplicationHash(title: string): string {
  return crypto.createHash('md5').update(title.toLowerCase().trim()).digest('hex');
}

function cleanDedupCache(): void {
  const now = Date.now();
  for (const [key, val] of deduplicationCache) {
    if (now - parseInt(val.split(':')[1]) > DEDUP_TTL) {
      deduplicationCache.delete(key);
    }
  }
}

export interface JiraIssueParams {
  title: string;
  description: string;
  priority?: 'Highest' | 'High' | 'Medium' | 'Low';
  labels?: string[];
  service: string;
  endpoint?: string;
  method?: string;
  stacktrace?: string;
  userId?: string;
  requestBody?: string;
  timestamp?: string;
}

function buildDescription(params: JiraIssueParams): object {
  const sections: object[] = [];

  sections.push({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: 'Error Details' }],
  });

  const fields = [
    `Service: ${params.service}`,
    params.endpoint ? `Endpoint: ${params.method || ''} ${params.endpoint}` : null,
    params.userId ? `User: ${params.userId}` : null,
    `Timestamp: ${params.timestamp || new Date().toISOString()}`,
  ].filter(Boolean);

  sections.push({
    type: 'codeBlock',
    attrs: { language: 'text' },
    content: [{ type: 'text', text: fields.join('\n') }],
  });

  if (params.stacktrace) {
    sections.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Stacktrace' }],
    });
    sections.push({
      type: 'codeBlock',
      attrs: { language: 'text' },
      content: [{ type: 'text', text: params.stacktrace.substring(0, 3000) }],
    });
  }

  if (params.requestBody) {
    sections.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Request Body' }],
    });
    sections.push({
      type: 'codeBlock',
      attrs: { language: 'json' },
      content: [{ type: 'text', text: params.requestBody.substring(0, 2000) }],
    });
  }

  return {
    type: 'doc',
    version: 1,
    content: sections,
  };
}

export async function createJiraBug(params: JiraIssueParams): Promise<string | null> {
  if (!JIRA_ENABLED || !JIRA_API_TOKEN) {
    return null;
  }

  // Deduplication check
  const hash = deduplicationHash(params.title);
  cleanDedupCache();
  if (deduplicationCache.has(hash)) {
    return deduplicationCache.get(hash)!.split(':')[0];
  }

  // Rate limit check
  if (!rateLimiter.canSend()) {
    console.warn('[JiraClient] Rate limit reached, skipping bug creation');
    return null;
  }

  const pair = `${JIRA_EMAIL}:${JIRA_API_TOKEN}`;
  const base64 = Buffer.from(pair).toString('base64');

  const body = {
    fields: {
      project: { key: JIRA_PROJECT_KEY },
      summary: params.title,
      description: buildDescription(params),
      issuetype: { name: 'Bug' },
      priority: { name: params.priority || 'High' },
      labels: params.labels || [],
    },
  };

  try {
    const response = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${base64}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[JiraClient] Failed to create bug: ${response.status} - ${errorText}`);
      return null;
    }

    const result = await response.json() as { key: string };
    const issueKey = result.key;
    const issueUrl = `${JIRA_BASE_URL}/browse/${issueKey}`;

    // Cache for deduplication
    deduplicationCache.set(hash, `${issueKey}:${Date.now()}`);
    rateLimiter.record();

    console.log(`[JiraClient] Bug created: ${issueKey} - ${issueUrl}`);
    return issueUrl;
  } catch (error) {
    console.error('[JiraClient] Error creating bug:', error);
    return null;
  }
}

export function getJiraConfig() {
  return {
    baseUrl: JIRA_BASE_URL,
    projectKey: JIRA_PROJECT_KEY,
    enabled: JIRA_ENABLED,
    hasToken: !!JIRA_API_TOKEN,
  };
}

// =============================================================================
// READ FUNCTIONS
// =============================================================================

function getAuthHeaders() {
  const pair = `${JIRA_EMAIL}:${JIRA_API_TOKEN}`;
  const base64 = Buffer.from(pair).toString('base64');
  return {
    'Authorization': `Basic ${base64}`,
    'Content-Type': 'application/json',
  };
}

export interface JiraIssue {
  key: string;
  id: string;
  summary: string;
  description: string;
  status: string;
  statusCategory: string;
  priority: string;
  issueType: string;
  labels: string[];
  assignee: string | null;
  reporter: string | null;
  created: string;
  updated: string;
  url: string;
  comments: JiraComment[];
}

export interface JiraComment {
  id: string;
  author: string;
  body: string;
  created: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  toStatus: string;
}

/**
 * Parse Atlassian Document Format (ADF) to plain text
 */
export function parseJiraDescription(adf: any): string {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;

  const texts: string[] = [];

  function extractText(node: any) {
    if (!node) return;

    if (node.type === 'text') {
      texts.push(node.text || '');
    }

    if (node.type === 'codeBlock') {
      texts.push('```\n' + (node.content?.map((c: any) => c.text).join('\n') || '') + '\n```');
    }

    if (node.type === 'heading') {
      texts.push('\n## ');
    }

    if (node.type === 'paragraph') {
      texts.push('\n');
    }

    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        extractText(child);
      }
    }
  }

  extractText(adf);
  return texts.join('').trim();
}

/**
 * Get a single Jira issue by key
 */
export async function getJiraIssue(issueKey: string): Promise<JiraIssue | null> {
  if (!JIRA_ENABLED || !JIRA_API_TOKEN) {
    return null;
  }

  try {
    const response = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}?fields=summary,description,status,priority,issuetype,labels,assignee,reporter,created,updated,comment`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      console.error(`[JiraClient] Failed to get issue: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    const fields = data.fields;

    const comments: JiraComment[] = (fields.comment?.comments || []).map((c: any) => ({
      id: c.id,
      author: c.author?.displayName || 'Unknown',
      body: parseJiraDescription(c.body),
      created: c.created,
    }));

    return {
      key: data.key,
      id: data.id,
      summary: fields.summary || '',
      description: parseJiraDescription(fields.description),
      status: fields.status?.name || 'Unknown',
      statusCategory: fields.status?.statusCategory?.name || 'Unknown',
      priority: fields.priority?.name || 'Medium',
      issueType: fields.issuetype?.name || 'Unknown',
      labels: fields.labels || [],
      assignee: fields.assignee?.displayName || null,
      reporter: fields.reporter?.displayName || null,
      created: fields.created,
      updated: fields.updated,
      url: `${JIRA_BASE_URL}/browse/${data.key}`,
      comments,
    };
  } catch (error) {
    console.error('[JiraClient] Error getting issue:', error);
    return null;
  }
}

/**
 * Search Jira issues with JQL
 */
export async function searchJiraIssues(
  jql: string,
  maxResults: number = 50
): Promise<JiraIssue[]> {
  if (!JIRA_ENABLED || !JIRA_API_TOKEN) {
    return [];
  }

  try {
    const encodedJql = encodeURIComponent(jql);
    const response = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/search?jql=${encodedJql}&maxResults=${maxResults}&fields=summary,status,priority,issuetype,labels,created,updated`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      console.error(`[JiraClient] Failed to search issues: ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    const issues = data.issues || [];

    return issues.map((issue: any) => {
      const fields = issue.fields;
      return {
        key: issue.key,
        id: issue.id,
        summary: fields.summary || '',
        description: parseJiraDescription(fields.description),
        status: fields.status?.name || 'Unknown',
        statusCategory: fields.status?.statusCategory?.name || 'Unknown',
        priority: fields.priority?.name || 'Medium',
        issueType: fields.issuetype?.name || 'Unknown',
        labels: fields.labels || [],
        assignee: fields.assignee?.displayName || null,
        reporter: fields.reporter?.displayName || null,
        created: fields.created,
        updated: fields.updated,
        url: `${JIRA_BASE_URL}/browse/${issue.key}`,
        comments: [],
      };
    });
  } catch (error) {
    console.error('[JiraClient] Error searching issues:', error);
    return [];
  }
}

/**
 * Get available transitions for an issue
 */
export async function getIssueTransitions(issueKey: string): Promise<JiraTransition[]> {
  if (!JIRA_ENABLED || !JIRA_API_TOKEN) {
    return [];
  }

  try {
    const response = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/transitions`,
      { headers: getAuthHeaders() }
    );

    if (!response.ok) {
      console.error(`[JiraClient] Failed to get transitions: ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    return (data.transitions || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      toStatus: t.to?.name || 'Unknown',
    }));
  } catch (error) {
    console.error('[JiraClient] Error getting transitions:', error);
    return [];
  }
}

/**
 * Transition an issue to a new status
 */
export async function transitionIssue(
  issueKey: string,
  transitionId: string
): Promise<boolean> {
  if (!JIRA_ENABLED || !JIRA_API_TOKEN) {
    return false;
  }

  try {
    const response = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/transitions`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ transition: { id: transitionId } }),
      }
    );

    if (!response.ok) {
      console.error(`[JiraClient] Failed to transition issue: ${response.status}`);
      return false;
    }

    console.log(`[JiraClient] Issue ${issueKey} transitioned to ${transitionId}`);
    return true;
  } catch (error) {
    console.error('[JiraClient] Error transitioning issue:', error);
    return false;
  }
}

/**
 * Add a comment to an issue
 */
export async function addComment(
  issueKey: string,
  body: string
): Promise<boolean> {
  if (!JIRA_ENABLED || !JIRA_API_TOKEN) {
    return false;
  }

  const adfBody = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: body }],
      },
    ],
  };

  try {
    const response = await fetch(
      `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ body: adfBody }),
      }
    );

    if (!response.ok) {
      console.error(`[JiraClient] Failed to add comment: ${response.status}`);
      return false;
    }

    console.log(`[JiraClient] Comment added to ${issueKey}`);
    return true;
  } catch (error) {
    console.error('[JiraClient] Error adding comment:', error);
    return false;
  }
}
