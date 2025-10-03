/**
 * Series Tree Builder
 * 
 * Builds hierarchical tree for series selector sidebar:
 * - Primary CT series at root
 * - RT structures nested under their referenced series
 * - Fusion secondaries nested under primary
 * - Each secondary's RT structures nested under it
 */

import type { DICOMSeries } from './dicom-utils';

export interface RTSeriesInfo {
  id: number;
  seriesInstanceUID: string;
  seriesDescription?: string;
  seriesNumber?: number;
  seriesDate?: string;
  referencedSeriesId?: number;
  referencedSeriesUID?: string;
  createdAt?: string;
}

export interface SeriesTreeNode {
  type: 'primary' | 'secondary' | 'rt' | 'other';
  series?: DICOMSeries;        // For primary/secondary nodes
  rtSeries?: RTSeriesInfo;     // For RT nodes
  children: SeriesTreeNode[];
  
  // Metadata
  id: number;                  // series.id or rtSeries.id
  label: string;               // Display name
  modality: string;            // CT, PET, RTSTRUCT, etc.
  isExpanded?: boolean;        // UI state
}

interface BuildTreeOptions {
  primarySeriesId: number;
  allSeries: DICOMSeries[];
  fusionCandidates: number[];  // Secondary series IDs
  rtStructures: RTSeriesInfo[];
  includeOtherSeries?: boolean;
}

/**
 * Build hierarchical tree for series selector
 */
export function buildSeriesTree(options: BuildTreeOptions): SeriesTreeNode[] {
  const {
    primarySeriesId,
    allSeries,
    fusionCandidates,
    rtStructures,
    includeOtherSeries = true
  } = options;

  const tree: SeriesTreeNode[] = [];
  const usedSeriesIds = new Set<number>([primarySeriesId]);

  // Find primary series
  const primarySeries = allSeries.find(s => s.id === primarySeriesId);
  if (!primarySeries) {
    console.warn('[buildSeriesTree] Primary series not found:', primarySeriesId);
    return tree;
  }

  // Build primary node
  const primaryNode: SeriesTreeNode = {
    type: 'primary',
    series: primarySeries,
    children: [],
    id: primarySeries.id,
    label: primarySeries.seriesDescription || `${primarySeries.modality} Series`,
    modality: primarySeries.modality || 'CT',
    isExpanded: true, // Primary always expanded by default
  };

  // Add RT structures that reference the primary series (by ID or UID)
  const primaryRTs = findReferencingRTStructures(primarySeries, rtStructures);
  for (const rtInfo of primaryRTs) {
    primaryNode.children.push(createRTNode(rtInfo));
  }

  // Add fusion secondary series as children
  for (const secondaryId of fusionCandidates) {
    usedSeriesIds.add(secondaryId);
    
    const secondarySeries = allSeries.find(s => s.id === secondaryId);
    if (!secondarySeries) continue;

    const secondaryNode: SeriesTreeNode = {
      type: 'secondary',
      series: secondarySeries,
      children: [],
      id: secondarySeries.id,
      label: secondarySeries.seriesDescription || `${secondarySeries.modality} Fusion`,
      modality: secondarySeries.modality || 'UNKNOWN',
      isExpanded: false, // Collapsed by default
    };

    // Nest RT structures that reference this secondary (e.g., PET RT)
    const secondaryRTs = findReferencingRTStructures(secondarySeries, rtStructures);
    for (const rtInfo of secondaryRTs) {
      secondaryNode.children.push(createRTNode(rtInfo));
    }

    primaryNode.children.push(secondaryNode);
  }

  tree.push(primaryNode);

  // Optionally include "Other Series" group
  if (includeOtherSeries) {
    const otherSeries = allSeries.filter(s => 
      !usedSeriesIds.has(s.id) && 
      (s.modality || '').toUpperCase() !== 'RTSTRUCT'
    );

    // Add other series as individual nodes and nest their RT structures
    for (const series of otherSeries) {
        const otherNode: SeriesTreeNode = {
          type: 'other',
          series,
          children: [],
          id: series.id,
          label: series.seriesDescription || `${series.modality} Series`,
          modality: series.modality || 'UNKNOWN',
          isExpanded: false,
        };

        const seriesRTs = findReferencingRTStructures(series, rtStructures);
        for (const rtInfo of seriesRTs) {
          otherNode.children.push(createRTNode(rtInfo));
        }

        tree.push(otherNode);
    }
  }

  return tree;
}

/**
 * Find RT structures that reference a given series
 */
function findReferencingRTStructures(
  series: DICOMSeries,
  rtStructures: RTSeriesInfo[]
): RTSeriesInfo[] {
  return rtStructures.filter(rt => {
    // Match by series ID (database reference)
    if (rt.referencedSeriesId === series.id) return true;
    
    // Match by series instance UID (DICOM reference)
    if (rt.referencedSeriesUID && rt.referencedSeriesUID === series.seriesInstanceUID) {
      return true;
    }
    
    return false;
  }).sort((a, b) => {
    // Sort by date (newest first), then by series number
    const dateA = a.seriesDate || a.createdAt || '';
    const dateB = b.seriesDate || b.createdAt || '';
    
    if (dateA && dateB && dateA !== dateB) {
      return dateB.localeCompare(dateA); // Descending
    }
    
    const numA = a.seriesNumber || 0;
    const numB = b.seriesNumber || 0;
    return numB - numA; // Descending
  });
}

/**
 * Create an RT node from RT series info
 */
function createRTNode(rtInfo: RTSeriesInfo): SeriesTreeNode {
  return {
    type: 'rt',
    rtSeries: rtInfo,
    children: [],
    id: rtInfo.id,
    label: rtInfo.seriesDescription || `RT Structure Set #${rtInfo.seriesNumber || rtInfo.id}`,
    modality: 'RTSTRUCT',
    isExpanded: false,
  };
}

/**
 * Find the most recent RT structure in the tree (for auto-load)
 */
export function findMostRecentPrimaryRT(tree: SeriesTreeNode[]): RTSeriesInfo | null {
  const primaryNode = tree.find(node => node.type === 'primary');
  if (!primaryNode) return null;

  const rtNodes = primaryNode.children.filter(child => child.type === 'rt');
  if (rtNodes.length === 0) return null;

  // Already sorted by date in buildSeriesTree, so first is most recent
  return rtNodes[0].rtSeries || null;
}

/**
 * Flatten tree to get all series IDs (for navigation/selection)
 */
export function getAllSeriesIdsFromTree(tree: SeriesTreeNode[]): number[] {
  const ids: number[] = [];
  
  function traverse(node: SeriesTreeNode) {
    if (node.series) ids.push(node.series.id);
    node.children.forEach(traverse);
  }
  
  tree.forEach(traverse);
  return ids;
}

