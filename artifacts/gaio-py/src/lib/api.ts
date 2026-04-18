import axios from 'axios'

const BASE_URL = import.meta.env.BASE_URL || '/gaio-py/'

export const api = axios.create({
  baseURL: `${BASE_URL}api`,
})

export function sseUrl(path: string): string {
  return `${BASE_URL}api/${path}`
}
