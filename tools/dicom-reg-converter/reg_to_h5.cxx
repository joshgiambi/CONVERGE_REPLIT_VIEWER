#include <itkCompositeTransform.h>
#include <itkDCMTKTransformIO.h>
#include <itkDCMTKTransformIOFactory.h>
#include <itkTransformFileReader.h>
#include <itkTransformFileWriter.h>

#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{
struct Arguments
{
  std::string inputReg;
  std::string outputTransform;
  std::optional<std::string> fixedFoR;
  std::optional<std::string> movingFoR;
};

void PrintUsage(const char *exec)
{
  std::cerr << "Usage: " << exec
            << " --input REG_FILE --output OUTPUT_H5 [--fixed FRAME_UID] [--moving FRAME_UID]\n";
}

Arguments ParseArguments(int argc, char *argv[])
{
  Arguments args;
  for (int i = 1; i < argc; ++i)
  {
    const std::string key(argv[i]);
    if ((key == "--input" || key == "-i") && i + 1 < argc)
    {
      args.inputReg = argv[++i];
    }
    else if ((key == "--output" || key == "-o") && i + 1 < argc)
    {
      args.outputTransform = argv[++i];
    }
    else if (key == "--fixed" && i + 1 < argc)
    {
      args.fixedFoR = std::string(argv[++i]);
    }
    else if (key == "--moving" && i + 1 < argc)
    {
      args.movingFoR = std::string(argv[++i]);
    }
    else if (key == "--help" || key == "-h")
    {
      PrintUsage(argv[0]);
      std::exit(EXIT_SUCCESS);
    }
    else
    {
      std::cerr << "Unknown argument: " << key << "\n";
      PrintUsage(argv[0]);
      std::exit(EXIT_FAILURE);
    }
  }

  if (args.inputReg.empty() || args.outputTransform.empty())
  {
    PrintUsage(argv[0]);
    std::exit(EXIT_FAILURE);
  }
  return args;
}

using ScalarType = double;
constexpr unsigned int Dimension = 3;
using ReaderType = itk::TransformFileReaderTemplate<ScalarType>;
using CompositeType = itk::CompositeTransform<ScalarType, Dimension>;
using Pointer = CompositeType::Pointer;

Pointer ReadComposite(const std::string &regPath, const std::string &frameOfReference)
{
  auto io = itk::DCMTKTransformIO<ScalarType>::New();
  io->SetFrameOfReferenceUID(frameOfReference);

  auto reader = ReaderType::New();
  reader->SetFileName(regPath);
  reader->SetTransformIO(io);
  reader->Update();

  auto *list = reader->GetTransformList();
  if (!list || list->empty())
  {
    throw std::runtime_error("No transforms found for frame of reference " + frameOfReference);
  }

  auto base = (*list->begin()).GetPointer();
  auto composite = dynamic_cast<CompositeType *>(base);
  if (!composite)
  {
    throw std::runtime_error("Expected CompositeTransform for frame " + frameOfReference);
  }
  return composite;
}

// Compose a transform that maps points in the fixed Frame of Reference
// (primary image space) into the moving Frame of Reference (secondary image
// space). DCMTK exposes per-frame CompositeTransform objects; to map between
// frames we compose the moving transform with the inverse of the fixed frame
// transform so the resulting affine matches the fixed->moving convention used
// by Eclipse and SimpleITK's ResampleImageFilter expectations.
Pointer ComposeFixedToMoving(const std::string &regPath,
                             const std::string &fixedFoR,
                             const std::string &movingFoR)
{
  Pointer fixed = ReadComposite(regPath, fixedFoR);
  Pointer moving = ReadComposite(regPath, movingFoR);

  fixed->FlattenTransformQueue();
  moving->FlattenTransformQueue();

  auto fixedInverse = CompositeType::New();
  if (!fixed->GetInverse(fixedInverse))
  {
    throw std::runtime_error("Fixed transform is not invertible");
  }

  auto final = CompositeType::New();
  final->AddTransform(moving);
  final->AddTransform(fixedInverse);
  final->FlattenTransformQueue();
  return final;
}

Pointer ExtractSingle(const std::string &regPath, const std::string &frameOfReference)
{
  Pointer fixed = ReadComposite(regPath, frameOfReference);
  auto final = CompositeType::New();
  final->AddTransform(fixed);
  final->FlattenTransformQueue();
  return final;
}

} // namespace

int main(int argc, char *argv[])
{
  try
  {
    Arguments args = ParseArguments(argc, argv);

    itk::DCMTKTransformIOFactory::RegisterOneFactory();

    Pointer transform;
    if (args.fixedFoR && args.movingFoR)
    {
      transform = ComposeFixedToMoving(args.inputReg, *args.fixedFoR, *args.movingFoR);
    }
    else if (args.fixedFoR)
    {
      transform = ExtractSingle(args.inputReg, *args.fixedFoR);
    }
    else
    {
      throw std::runtime_error("At least --fixed must be supplied to determine which transform to export");
    }

    auto writer = itk::TransformFileWriterTemplate<ScalarType>::New();
    writer->SetFileName(args.outputTransform);
    writer->SetInput(transform);
    writer->Update();
    return EXIT_SUCCESS;
  }
  catch (const itk::ExceptionObject &err)
  {
    std::cerr << "ITK error: " << err << "\n";
  }
  catch (const std::exception &ex)
  {
    std::cerr << "Error: " << ex.what() << "\n";
  }
  return EXIT_FAILURE;
}
