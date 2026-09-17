export type HeadingSummary = {
  totalPages: number;
  pagesWithSingleH1: number;
  pagesWithoutH1: number;
  pagesWithMultipleH1: number;
  pagesWithHierarchyIssues: number;
  problemPages: Array<{
    url: string;
    h1Count: number;
    hasHierarchyIssues: boolean;
  }>;
};

export function getHeadingSummary(headingStructure: unknown): HeadingSummary | null {
  if (
    typeof headingStructure !== "object"
    || headingStructure === null
    || !Array.isArray((headingStructure as { pages?: unknown }).pages)
  ) {
    return null;
  }

  const pages = (headingStructure as { pages: unknown[] }).pages.flatMap((page) => {
    if (
      typeof page !== "object"
      || page === null
      || typeof (page as { url?: unknown }).url !== "string"
      || typeof (page as { h1Count?: unknown }).h1Count !== "number"
    ) {
      return [];
    }

    return [{
      url: (page as { url: string }).url,
      h1Count: (page as { h1Count: number }).h1Count,
      hasHierarchyIssues: (page as { hasHierarchyIssues?: unknown }).hasHierarchyIssues === true,
    }];
  });

  return {
    totalPages: pages.length,
    pagesWithSingleH1: pages.filter((page) => page.h1Count === 1).length,
    pagesWithoutH1: pages.filter((page) => page.h1Count === 0).length,
    pagesWithMultipleH1: pages.filter((page) => page.h1Count > 1).length,
    pagesWithHierarchyIssues: pages.filter((page) => page.hasHierarchyIssues).length,
    problemPages: pages.filter((page) => page.h1Count !== 1 || page.hasHierarchyIssues),
  };
}