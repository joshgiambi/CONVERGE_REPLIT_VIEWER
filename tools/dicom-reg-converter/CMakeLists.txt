cmake_minimum_required(VERSION 3.16)
project(dicom_reg_converter)

find_package(ITK REQUIRED COMPONENTS
  ITKCommon
  IOTransformDCMTK
  ITKIOTransformHDF5
)

include(${ITK_USE_FILE})

add_executable(dicom_reg_to_h5 reg_to_h5.cxx)

set_target_properties(dicom_reg_to_h5 PROPERTIES
  CXX_STANDARD 17
  CXX_STANDARD_REQUIRED YES
  CXX_EXTENSIONS NO
)

target_link_libraries(dicom_reg_to_h5 PRIVATE ${ITK_LIBRARIES})

install(TARGETS dicom_reg_to_h5 RUNTIME DESTINATION bin)
