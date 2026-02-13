module math_utils
    implicit none
contains

    pure function square(x) result(res)
        integer, intent(in) :: x
        integer :: res
        res = x * x
    end function square

    pure function sum_squares(n) result(total)
        integer, intent(in) :: n
        integer :: total
        integer :: i
        total = 0
        do i = 1, n
            total = total + square(i)
        end do
    end function sum_squares

end module math_utils
