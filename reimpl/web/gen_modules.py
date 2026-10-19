# генерирует js/modules.browser.js со статическими импортами js/port/*.js и модулей рендера,
# регистрирующих функции в реестре F (renderer.js/fb.js подключает сам просмотрщик — это классы, не порт)
import os, glob
here = os.path.dirname(__file__)
port = sorted(os.path.basename(f) for f in glob.glob(os.path.join(here, '..', 'js', 'port', '*.js')))
render = [os.path.basename(f) for f in sorted(glob.glob(os.path.join(here, '..', 'js', 'render', '*.js')))
          if os.path.basename(f) not in ('renderer.js', 'fb.js')]
order = ['scene.js', 'sprites.js', 'hud.js', 'panel.js', 'text.js']              # порядок как в js/modules.js
render = [f for f in order if f in render] + [f for f in render if f not in order]
open(os.path.join(here, '..', 'js', 'modules.browser.js'), 'w').write(
    "import './core.js';\n" + ''.join("import './port/%s';\n" % f for f in port)
    + ''.join("import './render/%s';\n" % f for f in render))
print("modules.browser.js: port", port, "render", render)
