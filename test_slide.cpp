#include <stdio.h>
#include <mach-o/dyld.h>
int main() {
    printf("%ld\n", _dyld_get_image_vmaddr_slide(0));
    return 0;
}
