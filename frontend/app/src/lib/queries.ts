import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { active } from '../data/studies';
import type { Analysis, Quota } from '../types';

export function useQuota(enabled = true) { return useQuery({ queryKey: ['quota'], queryFn: ({ signal }) => api<Quota>('/auth/quota/', { signal }), enabled, staleTime: 15000 }); }
export function useAnalyses() {
  return useQuery({ queryKey: ['analyses'], queryFn: ({ signal }) => api<Analysis[]>('/analyses/', { signal }), refetchInterval: q => q.state.data?.some(a => active(a.status)) ? 4000 : false, refetchIntervalInBackground: false });
}
export function useAnalysis(id: string) {
  return useQuery({ queryKey: ['analysis', id], queryFn: ({ signal }) => api<Analysis>(`/analyses/${encodeURIComponent(id)}/`, { signal }), enabled: !!id, refetchInterval: q => q.state.data && active(q.state.data.status) ? 4000 : false, refetchIntervalInBackground: false });
}
