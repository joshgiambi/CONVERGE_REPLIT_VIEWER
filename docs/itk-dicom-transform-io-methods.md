# DICOM Spatial Transform IO in ITK – Methods and Example (verbatim)

Source: Insight Journal – DICOM Spatial Transform IO in the Insight Toolkit (McCormick et al., 2014).

## ITK Interface to DICOM Transforms

2 ITK Interface to DICOM Transforms

ITK uses an object factory mechanisms to support reading multiple ﬁle formats. For images, classes that
read and write speciﬁc ﬁle formats inherit from the itk::ImageIOBase, and the itk::ImageFileReader
uses the objects registered to the factory to attempt to read, then read, a given ﬁle. Similarly, the classes
that inherit itk::TransformIOBaseTemplate to read speciﬁc transform ﬁle formats are registered in the
factory, and itk::TransformFileReaderTemplate uses this factory to read a given transform ﬁle name.

We wrote an itk::DCMTKTransformIO class that inherits from itk::TransformIOBaseTemplate, and
can read DICOM SRO ﬁles. Internally, this class uses the DCMTK library [1] to read the ﬁle.

a

a
Since
possible,
itk::CompositeTransform. The ITK transforms that correspond to the various DICOM transform

itk::DCMTKTransformIO

transforms

generates

sequence

of

is

Latest version available at the Insight Journal [ http://hdl.handle.net/10380/3468]
Distributed under Creative Commons Attribution License


3

DICOM Type
RIGID SCALE
RIGID
AFFINE

ITK Type
itk::ScaleTransform
itk::Euler3DTransform
itk::AffineTransform

Table 1: DICOM transform types and their corresponding ITK transform type.

types are listed in Table 2.

The default output of the DCMTKTransformIO is the concatenation of all transforms found in the SRO
in the resulting itk::CompositeTransform. To request only the transforms corresponding to a speciﬁc
Frame of Reference, call SetFrameOfReferenceUID.

To ﬁnd the spatial transform between the Frame of Reference for a Fixed Image and the Frame of Reference
## Example

```cpp
Distributed under Creative Commons Attribution License


* See the License for the specific language governing permissions and
* limitations under the License.
*
*=========================================================================*/

4

#include "itkDCMTKTransformIO.h"
#include "itkDCMTKTransformIOFactory.h"
#include "itkTransformFileReader.h"
#include "itkImageSeriesReader.h"
#include "itkDCMTKImageIO.h"
#include "itkDCMTKSeriesFileNames.h"
#include "itkGDCMImageIO.h"
#include "itkGDCMSeriesFileNames.h"
#include "itkCompositeTransform.h"
#include "itkImageFileWriter.h"
#include "itkMetaDataObject.h"
#include "itkResampleImageFilter.h"

int ReadDicomTransformAndResampleExample( int argc, char* argv[] )
{

// Parse command line arguments
if( argc < 5 )

{
std::cerr << "Usage: " << argv[0]

<< " fixedSeriesDirectory movingSeriesDirectory"
<< " transform fixedImageOutput resampledMovingOutput"
<< std::endl;

return EXIT_FAILURE;
}

const char * fixedSeriesDirectory = argv[1];
const char * movingSeriesDirectory = argv[2];
const char * transformFileName = argv[3];
const char * fixedImageOutputFileName = argv[4];
const char * resampledMovingOutputFileName = argv[5];

// Basic types
const unsigned int Dimension = 3;
PixelType;
typedef short
typedef itk::Image< PixelType, Dimension > ImageType;

// Read the fixed and moving image
typedef itk::ImageSeriesReader< ImageType > ReaderType;
ReaderType::Pointer fixedReader = ReaderType::New();

// DCMTKImageIO does not populate the MetaDataDictionary yet
//typedef itk::DCMTKImageIO ImageIOType;
typedef itk::GDCMImageIO ImageIOType;
ImageIOType::Pointer fixedIO = ImageIOType::New();
fixedReader->SetImageIO( fixedIO );

//typedef itk::DCMTKSeriesFileNames SeriesFileNamesType;
typedef itk::GDCMSeriesFileNames SeriesFileNamesType;
SeriesFileNamesType::Pointer fixedSeriesFileNames =

SeriesFileNamesType::New();

fixedSeriesFileNames->SetInputDirectory( fixedSeriesDirectory );
typedef SeriesFileNamesType::FileNamesContainerType FileNamesContainerType;

Latest version available at the Insight Journal [ http://hdl.handle.net/10380/3468]
Distributed under Creative Commons Attribution License


5

const FileNamesContainerType & fixedFileNames =

fixedSeriesFileNames->GetInputFileNames();

std::cout << "There are "

<< fixedFileNames.size()
<< " fixed image slices."
<< std::endl;

std::cout << "First fixed images series UID: "

<< fixedSeriesFileNames->GetSeriesUIDs()[0]
<< "\n" << std::endl;

fixedReader->SetFileNames( fixedFileNames );

ReaderType::Pointer movingReader = ReaderType::New();
ImageIOType::Pointer movingIO = ImageIOType::New();
movingReader->SetImageIO( movingIO );

SeriesFileNamesType::Pointer movingSeriesFileNames =

SeriesFileNamesType::New();

movingSeriesFileNames->SetInputDirectory( movingSeriesDirectory );
const FileNamesContainerType & movingFileNames =

movingSeriesFileNames->GetInputFileNames();

std::cout << "There are "

<< movingFileNames.size()
<< " moving image slices."
<< std::endl;

std::cout << "First moving images series UID: "

<< movingSeriesFileNames->GetSeriesUIDs()[0]
<< "\n" << std::endl;

movingReader->SetFileNames( movingFileNames );

try
{
fixedReader->Update();
movingReader->Update();
}

catch( itk::ExceptionObject & error )

{
std::cerr << "Error: " << error << std::endl;
return EXIT_FAILURE;
}

// Create a DICOM transform reader
typedef float ScalarType;

itk::DCMTKTransformIOFactory::Pointer dcmtkTransformIOFactory =

itk::DCMTKTransformIOFactory::New();

itk::ObjectFactoryBase::RegisterFactory( dcmtkTransformIOFactory );

typedef itk::TransformFileReaderTemplate< ScalarType > TransformReaderType;
TransformReaderType::Pointer transformReader = TransformReaderType::New();
transformReader->SetFileName( transformFileName );

typedef itk::DCMTKTransformIO< ScalarType > TransformIOType;
TransformIOType::Pointer transformIO = TransformIOType::New();
transformReader->SetTransformIO( transformIO );

// Read in the fixed image transform
const ReaderType::DictionaryType & fixedMetaDataDict =

Latest version available at the Insight Journal [ http://hdl.handle.net/10380/3468]
Distributed under Creative Commons Attribution License


6

fixedIO->GetMetaDataDictionary();
std::string fixedFrameOfReferenceUID;
if( ! itk::ExposeMetaData< std::string >( fixedMetaDataDict,

"0020|0052",
fixedFrameOfReferenceUID ) )

{
std::cerr << "Could not find the fixed image frame of reference UID." << std::endl;
return EXIT_FAILURE;
}

std::cout << "Fixed image frame of reference UID: "
<< fixedFrameOfReferenceUID << std::endl;

transformIO->SetFrameOfReferenceUID( fixedFrameOfReferenceUID );

try
{
transformReader->Update();
}

catch( itk::ExceptionObject & error )

{
std::cerr << "Error: " << error << std::endl;
return EXIT_FAILURE;
}

typedef TransformReaderType::TransformListType TransformListType;
TransformListType * transformList = transformReader->GetTransformList();

typedef itk::CompositeTransform< ScalarType, Dimension > ReadTransformType;
TransformListType::const_iterator transformIt = transformList->begin();
ReadTransformType::Pointer fixedTransform =

dynamic_cast< ReadTransformType * >( (*transformIt).GetPointer() );

if( fixedTransform.IsNull() )

{
std::cerr << "Did not get the expected transform out." << std::endl;
return EXIT_FAILURE;
}

std::cout << "Fixed transform: " << fixedTransform << std::endl;

// Read in the moving image transform
const ReaderType::DictionaryType & movingMetaDataDict =

movingIO->GetMetaDataDictionary();
std::string movingFrameOfReferenceUID;
if( ! itk::ExposeMetaData< std::string >( movingMetaDataDict,

"0020|0052",
movingFrameOfReferenceUID ) )

{
std::cerr << "Could not find the moving image frame of reference UID." << std::endl;
return EXIT_FAILURE;
}

std::cout << "Moving image frame of reference UID: "
<< movingFrameOfReferenceUID << std::endl;

transformIO->SetFrameOfReferenceUID( movingFrameOfReferenceUID );

try
{
transformReader->Update();
}

catch( itk::ExceptionObject & error )

{
std::cerr << "Error: " << error << std::endl;

Latest version available at the Insight Journal [ http://hdl.handle.net/10380/3468]
Distributed under Creative Commons Attribution License


7

return EXIT_FAILURE;
}

transformList = transformReader->GetTransformList();
transformIt = transformList->begin();
ReadTransformType::Pointer movingTransform =

dynamic_cast< ReadTransformType * >( (*transformIt).GetPointer() );

if( movingTransform.IsNull() )

{
std::cerr << "Did not get the expected transform out." << std::endl;
return EXIT_FAILURE;
}

std::cout << "Moving transform: " << movingTransform << std::endl;

// Compose the transform from the fixed to the moving image
ReadTransformType::Pointer movingTransformInverse = ReadTransformType::New();
movingTransform->GetInverse( movingTransformInverse );

ReadTransformType::Pointer fixedToMovingTransform = ReadTransformType::New();
fixedToMovingTransform->AddTransform( fixedTransform );
fixedToMovingTransform->AddTransform( movingTransformInverse );
// Flatten out the two component CompositeTransforms.
fixedToMovingTransform->FlattenTransformQueue();

typedef itk::ResampleImageFilter< ImageType, ImageType, ScalarType, ScalarType >

ResamplerType;

ResamplerType::Pointer resampler = ResamplerType::New();
resampler->SetInput( movingReader->GetOutput() );
resampler->SetUseReferenceImage( true );
resampler->SetReferenceImage( fixedReader->GetOutput() );
resampler->SetTransform( fixedToMovingTransform );
resampler->SetDefaultPixelValue( -1000 );

// Write the fixed image and resampled moving image (should look similar)
typedef itk::ImageFileWriter< ImageType > WriterType;
WriterType::Pointer writer = WriterType::New();
writer->SetFileName( fixedImageOutputFileName );
writer->SetInput( fixedReader->GetOutput() );
try
{
writer->Update();
}

catch( itk::ExceptionObject & error )

{
std::cerr << "Error: " << error << std::endl;
return EXIT_FAILURE;
}

writer->SetInput( resampler->GetOutput() );
writer->SetFileName( resampledMovingOutputFileName );
try
{
writer->Update();
}

catch( itk::ExceptionObject & error )

```
