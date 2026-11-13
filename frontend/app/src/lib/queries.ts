import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { active } from '../data/studies';
import type { Analysis, Quota, ProjectPage, ProjectSummary, ReceivedProject } from '../types';

export function useQuota(enabled = true) { return useQuery({ queryKey: ['quota'], queryFn: ({ signal }) => api<Quota>('/auth/quota/', { signal }), enabled, staleTime: 15000 }); }
export function useAnalyses() {
  return useQuery({ queryKey: ['analyses'], queryFn: ({ signal }) => api<Analysis[]>('/analyses/', { signal }), refetchInterval: q => q.state.data?.some(a => active(a.status)) ? 4000 : false, refetchIntervalInBackground: false });
}
export function useFeatured(page = 1) {
  return useQuery({ queryKey: ['featured', page], queryFn: ({ signal }) => api<ProjectPage<ProjectSummary>>(`/featured/?page=${page}`, { auth: false, signal, cache: 'no-store' }), staleTime: 0 });
}
export function useReceived(page = 1) {
  return useQuery({ queryKey: ['received', page], queryFn: ({ signal }) => api<ProjectPage<ReceivedProject>>(`/received/?page=${page}`, { signal, cache: 'no-store' }), staleTime: 0 });
}
export function useAnalysis(id: string, shared = false) {
  return useQuery({
    queryKey: [shared ? 'shared-analysis' : 'analysis', id],
    queryFn: ({ signal }) => api<Analysis>(`/${shared ? 'shared' : 'analyses'}/${encodeURIComponent(id)}/`, { signal, auth: !shared, cache: 'no-store' }),
    enabled: !!id, staleTime: shared ? 0 : undefined, gcTime: shared ? 0 : undefined,
    refetchInterval: q => shared ? (q.state.status === 'error' ? false : 15000) : q.state.data && active(q.state.data.status) ? 4000 : false,
    refetchIntervalInBackground: false,
  });
}
