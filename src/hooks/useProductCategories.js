import { useEffect, useState } from 'react';
import { DEFAULT_CATEGORIES } from '../data/products.js';

// One request per visit, shared by the homepage and the Products page.
let request = null;

function loadCategories() {
  if (!request) {
    request = fetch('/api/products/categories')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => (Array.isArray(data?.categories) && data.categories.length ? data.categories : null))
      .catch(() => null);
  }
  return request;
}

/** Product categories in the order approvers chose; the built-in list until (or unless) they load. */
export default function useProductCategories() {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  useEffect(() => {
    let cancelled = false;
    loadCategories().then((list) => { if (list && !cancelled) setCategories(list); });
    return () => { cancelled = true; };
  }, []);
  return categories;
}
