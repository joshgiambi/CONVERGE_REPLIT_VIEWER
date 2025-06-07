import { C_FIND_SCP, C_FIND_SCU, C_MOVE_SCU, C_ECHO_SCU } from 'dicom-dimse';
import * as dcmjs from 'dcmjs';
import { PacsConnection, NetworkQuery } from '@shared/schema';

export interface DICOMQueryResult {
  patientName?: string;
  patientID?: string;
  studyInstanceUID?: string;
  studyDate?: string;
  studyTime?: string;
  studyDescription?: string;
  accessionNumber?: string;
  modality?: string;
  numberOfStudyRelatedSeries?: number;
  numberOfStudyRelatedInstances?: number;
}

export interface DICOMWebConfig {
  wadoUri?: string;
  qidoUri?: string;
  stowUri?: string;
  headers?: Record<string, string>;
}

export class DICOMNetworkService {
  private connections: Map<number, PacsConnection> = new Map();

  constructor() {
    this.initializeConnections();
  }

  private async initializeConnections() {
    // Load PACS connections from database
    // This would be implemented with the database service
  }

  /**
   * Test connection to PACS using C-ECHO
   */
  async testConnection(connection: PacsConnection): Promise<boolean> {
    try {
      const client = new C_ECHO_SCU({
        callingAeTitle: connection.callingAeTitle,
        calledAeTitle: connection.aeTitle,
        host: connection.hostname,
        port: connection.port,
        timeout: 10000
      });

      const result = await client.echo();
      return result.status === 0;
    } catch (error) {
      console.error('DICOM connection test failed:', error);
      return false;
    }
  }

  /**
   * Query PACS for studies using C-FIND
   */
  async queryStudies(
    connection: PacsConnection,
    queryParams: Partial<DICOMQueryResult>
  ): Promise<DICOMQueryResult[]> {
    if (connection.protocol === 'DICOMweb') {
      return this.queryStudiesDICOMWeb(connection, queryParams);
    } else {
      return this.queryStudiesDIMSE(connection, queryParams);
    }
  }

  /**
   * Query studies using traditional DICOM DIMSE (C-FIND)
   */
  private async queryStudiesDIMSE(
    connection: PacsConnection,
    queryParams: Partial<DICOMQueryResult>
  ): Promise<DICOMQueryResult[]> {
    try {
      const client = new C_FIND_SCU({
        callingAeTitle: connection.callingAeTitle,
        calledAeTitle: connection.aeTitle,
        host: connection.hostname,
        port: connection.port,
        timeout: 30000
      });

      // Build DICOM query dataset
      const queryDataset = {
        QueryRetrieveLevel: 'STUDY',
        PatientName: queryParams.patientName || '',
        PatientID: queryParams.patientID || '',
        StudyInstanceUID: queryParams.studyInstanceUID || '',
        StudyDate: queryParams.studyDate || '',
        StudyTime: queryParams.studyTime || '',
        StudyDescription: queryParams.studyDescription || '',
        AccessionNumber: queryParams.accessionNumber || '',
        ModalitiesInStudy: queryParams.modality || '',
        NumberOfStudyRelatedSeries: '',
        NumberOfStudyRelatedInstances: ''
      };

      const results = await client.find(queryDataset);
      
      return results.map((result: any) => ({
        patientName: result.PatientName,
        patientID: result.PatientID,
        studyInstanceUID: result.StudyInstanceUID,
        studyDate: result.StudyDate,
        studyTime: result.StudyTime,
        studyDescription: result.StudyDescription,
        accessionNumber: result.AccessionNumber,
        modality: result.ModalitiesInStudy,
        numberOfStudyRelatedSeries: parseInt(result.NumberOfStudyRelatedSeries) || 0,
        numberOfStudyRelatedInstances: parseInt(result.NumberOfStudyRelatedInstances) || 0
      }));
    } catch (error) {
      console.error('DICOM study query failed:', error);
      throw new Error(`Failed to query studies: ${error}`);
    }
  }

  /**
   * Query studies using DICOMweb (QIDO-RS)
   */
  private async queryStudiesDICOMWeb(
    connection: PacsConnection,
    queryParams: Partial<DICOMQueryResult>
  ): Promise<DICOMQueryResult[]> {
    if (!connection.qidoUri) {
      throw new Error('QIDO-RS URI not configured for DICOMweb connection');
    }

    try {
      const searchParams = new URLSearchParams();
      
      if (queryParams.patientName) searchParams.append('PatientName', queryParams.patientName);
      if (queryParams.patientID) searchParams.append('PatientID', queryParams.patientID);
      if (queryParams.studyDate) searchParams.append('StudyDate', queryParams.studyDate);
      if (queryParams.studyDescription) searchParams.append('StudyDescription', queryParams.studyDescription);
      if (queryParams.accessionNumber) searchParams.append('AccessionNumber', queryParams.accessionNumber);
      if (queryParams.modality) searchParams.append('ModalitiesInStudy', queryParams.modality);

      const url = `${connection.qidoUri}/studies?${searchParams.toString()}`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/dicom+json',
          'Content-Type': 'application/dicom+json'
        }
      });

      if (!response.ok) {
        throw new Error(`DICOMweb query failed: ${response.statusText}`);
      }

      const studies = await response.json();
      
      return studies.map((study: any) => ({
        patientName: study['00100010']?.Value?.[0],
        patientID: study['00100020']?.Value?.[0],
        studyInstanceUID: study['0020000D']?.Value?.[0],
        studyDate: study['00080020']?.Value?.[0],
        studyTime: study['00080030']?.Value?.[0],
        studyDescription: study['00081030']?.Value?.[0],
        accessionNumber: study['00080050']?.Value?.[0],
        modality: study['00080061']?.Value?.[0],
        numberOfStudyRelatedSeries: study['00201206']?.Value?.[0],
        numberOfStudyRelatedInstances: study['00201208']?.Value?.[0]
      }));
    } catch (error) {
      console.error('DICOMweb study query failed:', error);
      throw new Error(`Failed to query studies via DICOMweb: ${error}`);
    }
  }

  /**
   * Retrieve study from PACS using C-MOVE
   */
  async retrieveStudy(
    connection: PacsConnection,
    studyInstanceUID: string,
    destinationAE: string
  ): Promise<boolean> {
    try {
      const client = new C_MOVE_SCU({
        callingAeTitle: connection.callingAeTitle,
        calledAeTitle: connection.aeTitle,
        host: connection.hostname,
        port: connection.port,
        timeout: 300000 // 5 minutes for large studies
      });

      const moveDataset = {
        QueryRetrieveLevel: 'STUDY',
        StudyInstanceUID: studyInstanceUID
      };

      const result = await client.move(moveDataset, destinationAE);
      return result.status === 0;
    } catch (error) {
      console.error('DICOM study retrieval failed:', error);
      throw new Error(`Failed to retrieve study: ${error}`);
    }
  }

  /**
   * Retrieve study via DICOMweb (WADO-RS)
   */
  async retrieveStudyDICOMWeb(
    connection: PacsConnection,
    studyInstanceUID: string
  ): Promise<ArrayBuffer[]> {
    if (!connection.wadoUri) {
      throw new Error('WADO-RS URI not configured for DICOMweb connection');
    }

    try {
      const url = `${connection.wadoUri}/studies/${studyInstanceUID}`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'multipart/related; type="application/dicom"'
        }
      });

      if (!response.ok) {
        throw new Error(`DICOMweb retrieval failed: ${response.statusText}`);
      }

      // Parse multipart response to extract DICOM files
      const buffer = await response.arrayBuffer();
      return [buffer]; // Simplified - would need proper multipart parsing
    } catch (error) {
      console.error('DICOMweb study retrieval failed:', error);
      throw new Error(`Failed to retrieve study via DICOMweb: ${error}`);
    }
  }

  /**
   * Send study to PACS using C-STORE or STOW-RS
   */
  async sendStudy(
    connection: PacsConnection,
    dicomFiles: ArrayBuffer[]
  ): Promise<boolean> {
    if (connection.protocol === 'DICOMweb') {
      return this.sendStudyDICOMWeb(connection, dicomFiles);
    } else {
      return this.sendStudyDIMSE(connection, dicomFiles);
    }
  }

  private async sendStudyDIMSE(
    connection: PacsConnection,
    dicomFiles: ArrayBuffer[]
  ): Promise<boolean> {
    // Implementation would use C-STORE SCU from dicom-dimse
    // This is a complex operation requiring proper DICOM dataset handling
    throw new Error('C-STORE implementation requires additional DICOM handling');
  }

  private async sendStudyDICOMWeb(
    connection: PacsConnection,
    dicomFiles: ArrayBuffer[]
  ): Promise<boolean> {
    if (!connection.stowUri) {
      throw new Error('STOW-RS URI not configured for DICOMweb connection');
    }

    try {
      // Create multipart form data with DICOM files
      const formData = new FormData();
      
      dicomFiles.forEach((file, index) => {
        const blob = new Blob([file], { type: 'application/dicom' });
        formData.append(`file${index}`, blob);
      });

      const response = await fetch(`${connection.stowUri}/studies`, {
        method: 'POST',
        headers: {
          'Accept': 'application/dicom+json'
        },
        body: formData
      });

      return response.ok;
    } catch (error) {
      console.error('DICOMweb study send failed:', error);
      return false;
    }
  }

  /**
   * Get connection status for all configured PACS
   */
  async getConnectionStatuses(): Promise<Map<number, boolean>> {
    const statuses = new Map<number, boolean>();
    
    for (const [id, connection] of this.connections) {
      try {
        const isConnected = await this.testConnection(connection);
        statuses.set(id, isConnected);
      } catch {
        statuses.set(id, false);
      }
    }
    
    return statuses;
  }
}

export const dicomNetworkService = new DICOMNetworkService();