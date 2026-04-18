from typing import List, Dict, Any
from bs4 import BeautifulSoup
import extruct
import json
from .crawler import CrawlResult

IMPORTANT_B2B_TYPES = ["Organization", "Product", "FAQPage", "BreadcrumbList",
                        "WebPage", "WebSite", "LocalBusiness", "Service",
                        "ItemList", "Article", "HowTo"]

PRODUCT_REQUIRED_PROPS = ["name", "description", "image"]
PRODUCT_RECOMMENDED_PROPS = ["offers", "manufacturer", "sku", "brand", "category"]
ORG_REQUIRED_PROPS = ["name", "url"]
ORG_RECOMMENDED_PROPS = ["logo", "contactPoint", "address", "sameAs", "description"]


def extract_schema_types(data: dict) -> List[str]:
    """Recursively extract all @type values from schema data."""
    types = []
    if isinstance(data, dict):
        t = data.get("@type")
        if t:
            types.append(t if isinstance(t, str) else t[0] if t else "")
        for v in data.values():
            types.extend(extract_schema_types(v))
    elif isinstance(data, list):
        for item in data:
            types.extend(extract_schema_types(item))
    return [t for t in types if t]


def analyze_schema(results: List[CrawlResult]) -> Dict[str, Any]:
    all_types = {}  # type -> count
    has_product_schema = False
    has_org_schema = False
    has_faq_schema = False
    product_props_found = set()
    product_props_missing = []
    org_props_found = set()
    org_props_missing = []
    pages_with_schema = 0
    schema_errors = []

    for result in results:
        if not result.html:
            continue
        try:
            data = extruct.extract(result.html, base_url=result.url,
                                   syntaxes=["json-ld", "microdata", "opengraph"],
                                   uniform=True)
        except Exception as e:
            schema_errors.append(f"{result.url}: {str(e)[:100]}")
            continue

        page_has_schema = False
        for syntax_data in data.values():
            if not syntax_data:
                continue
            for item in syntax_data:
                page_has_schema = True
                types = extract_schema_types(item)
                for t in types:
                    all_types[t] = all_types.get(t, 0) + 1

                # Deep analysis for key types
                item_type = item.get("@type", "")
                if isinstance(item_type, list):
                    item_type = item_type[0] if item_type else ""

                if item_type == "Product":
                    has_product_schema = True
                    for prop in PRODUCT_REQUIRED_PROPS + PRODUCT_RECOMMENDED_PROPS:
                        if item.get(prop):
                            product_props_found.add(prop)

                if item_type == "Organization":
                    has_org_schema = True
                    for prop in ORG_REQUIRED_PROPS + ORG_RECOMMENDED_PROPS:
                        if item.get(prop):
                            org_props_found.add(prop)

                if item_type == "FAQPage":
                    has_faq_schema = True

        if page_has_schema:
            pages_with_schema += 1

    # Compute missing props
    if has_product_schema:
        product_props_missing = [p for p in PRODUCT_REQUIRED_PROPS + PRODUCT_RECOMMENDED_PROPS
                                  if p not in product_props_found]
    if has_org_schema:
        org_props_missing = [p for p in ORG_REQUIRED_PROPS + ORG_RECOMMENDED_PROPS
                              if p not in org_props_found]

    # Missing high-value types
    missing_important = [t for t in IMPORTANT_B2B_TYPES if t not in all_types]

    # Score
    score = 0
    if pages_with_schema > 0:
        score += 20
    if has_org_schema:
        score += 20
        score += min(20, len(org_props_found) * 3)
    if has_product_schema:
        score += 20
        score += min(15, len(product_props_found) * 2)
    if has_faq_schema:
        score += 15
    if "BreadcrumbList" in all_types:
        score += 5
    if len(all_types) >= 4:
        score += 5
    score = min(100, score)

    return {
        "score": score,
        "types_found": all_types,
        "pages_with_schema": pages_with_schema,
        "total_pages": len(results),
        "has_product_schema": has_product_schema,
        "has_org_schema": has_org_schema,
        "has_faq_schema": has_faq_schema,
        "product_props_found": list(product_props_found),
        "product_props_missing": product_props_missing,
        "org_props_found": list(org_props_found),
        "org_props_missing": org_props_missing,
        "missing_important_types": missing_important,
        "schema_errors": schema_errors,
    }
