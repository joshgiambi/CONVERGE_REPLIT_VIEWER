#!/bin/bash

# Check RT structure references via the API (requires server to be running)

echo "🔍 Checking RT Structure References via API..."
echo ""

# Get the study ID - you need to replace this with your actual study ID
# You can find it in the URL when viewing the patient: /patient/X/study/Y
read -p "Enter Study ID: " STUDY_ID

if [ -z "$STUDY_ID" ]; then
  echo "❌ No study ID provided"
  exit 1
fi

echo ""
echo "📡 Fetching series for study $STUDY_ID..."
echo ""

# Fetch all series
curl -s "http://localhost:5000/api/studies/$STUDY_ID/series" | jq '
  .[] |
  select(.modality == "RTSTRUCT" or .modality == "CT") |
  {
    id: .id,
    modality: .modality,
    description: .seriesDescription,
    referencedSeriesId: .referencedSeriesId,
    imageCount: .imageCount
  }
'

echo ""
echo "💡 To fix RT structure references:"
echo "   Look for RTSTRUCT entries with referencedSeriesId: null"
echo "   Then update them to point to the correct CT series ID"