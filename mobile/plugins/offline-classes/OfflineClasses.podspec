require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'OfflineClasses'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'MIT'
  s.homepage = 'https://caparveensharma.com'
  s.author = 'CA Parveen Sharma'
  s.source = { :git => 'https://caparveensharma.com', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/OfflineClassesPlugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
